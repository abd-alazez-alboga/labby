package com.labby.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.config.SurgeProperties;
import com.labby.backend.config.TrackingProperties;
import com.labby.backend.dto.HeatmapDto;
import com.labby.backend.dto.HeatmapZoneDto;
import com.labby.backend.dto.SurgeStateDto;
import com.labby.backend.dto.SurgeZoneStateDto;
import com.labby.backend.dto.ThresholdStepDto;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Region;
import com.labby.backend.model.SurgeZone;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.SurgeZoneRepository;
import com.labby.backend.util.GeoJson;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The PRC-02 surge cycle. Demand and supply are counted in SQL per zone (one indexed query, see
 * {@link SurgeZoneRepository#countDemandAndSupply}); the step/cap mapping is the {@link
 * SurgeCalculator}'s. Each zone is locked with SKIP LOCKED in its own transaction so several
 * instances can run the cycle (NFR-P4) and one failing zone never stops the others. The override
 * wins over the computed value at the cycle, never before (UC-A-09: takes effect next cycle).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SurgeServiceImpl implements SurgeService {

  private final SurgeZoneRepository surgeZoneRepository;
  private final RegionRepository regionRepository;
  private final SurgeCalculator surgeCalculator;
  private final MoneyFloors moneyFloors;
  private final RideAccess rideAccess;
  private final TrackingProperties trackingProperties;
  private final SurgeProperties surgeProperties;
  private final TransactionTemplate transactionTemplate;
  private final ObjectMapper objectMapper;
  private final Clock clock;

  @Override
  public int recompute() {
    Instant now = clock.instant();
    Instant freshAfter = now.minusSeconds(trackingProperties.staleAfterSeconds());
    int processed = 0;
    for (UUID surgeZoneId : surgeZoneRepository.findIdsInActiveRegions()) {
      try {
        if (Boolean.TRUE.equals(
            transactionTemplate.execute(status -> recomputeZone(surgeZoneId, now, freshAfter)))) {
          processed++;
        }
      } catch (RuntimeException ex) {
        log.warn("Surge cycle failed for zone {}: {}", surgeZoneId, ex.getClass().getSimpleName());
      }
    }
    return processed;
  }

  private boolean recomputeZone(UUID surgeZoneId, Instant now, Instant freshAfter) {
    Optional<SurgeZone> locked = surgeZoneRepository.lockIfFree(surgeZoneId);
    if (locked.isEmpty()) {
      return false;
    }
    SurgeZone zone = locked.get();
    Region region = regionRepository.findById(zone.getRegionId()).orElseThrow();
    SurgeZoneRepository.ZoneCounts counts =
        surgeZoneRepository.countDemandAndSupply(
            surgeZoneId, freshAfter, MoneyFloors.DEFAULT_FLOOR);
    BigDecimal computed =
        surgeCalculator.computed(
            steps(zone),
            counts.getDemand(),
            counts.getSupply(),
            zone.getMultiplierCap(),
            region.getSurgeCap());
    BigDecimal current =
        surgeCalculator.current(
            zone.getOverrideMultiplier(), computed, zone.getMultiplierCap(), region.getSurgeCap());
    surgeZoneRepository.storeCycle(
        surgeZoneId,
        computed,
        current,
        Math.toIntExact(counts.getDemand()),
        Math.toIntExact(counts.getSupply()),
        now);
    return true;
  }

  @Override
  @Transactional(readOnly = true)
  public SurgeStateDto surgeState(UUID regionId) {
    Region region =
        regionRepository
            .findById(regionId)
            .orElseThrow(() -> new ResourceNotFoundException("Region", regionId));
    return new SurgeStateDto(
        region.getId(),
        region.getSurgeCap(),
        utc(nextCycleAt()),
        surgeZoneRepository.findByRegionIdOrderByNameAsc(regionId).stream()
            .map(zone -> state(zone, region))
            .toList());
  }

  @Override
  @Transactional(readOnly = true)
  public HeatmapDto heatmap(UUID driverUserId) {
    rideAccess.requireDriver(driverUserId);
    Region region =
        moneyFloors
            .operatingRegion(driverUserId)
            .orElseThrow(
                () ->
                    new ResourceNotFoundException(
                            "No operating region yet; go online inside a region first")
                        .withCode("no_operating_region"));
    List<SurgeZone> zones = surgeZoneRepository.findByRegionIdOrderByNameAsc(region.getId());
    Instant computedAt =
        zones.stream()
            .map(SurgeZone::getComputedAt)
            .filter(Objects::nonNull)
            .max(Comparator.naturalOrder())
            .orElse(null);
    return new HeatmapDto(
        region.getId(),
        utc(computedAt),
        utc(nextCycleAt()),
        zones.stream()
            .map(
                zone ->
                    new HeatmapZoneDto(
                        zone.getId(),
                        zone.getName(),
                        GeoJson.toDto(zone.getPolygon()),
                        zone.getCurrentMultiplier(),
                        surgeCalculator.level(steps(zone), zone.getCurrentMultiplier())))
            .toList());
  }

  private SurgeZoneStateDto state(SurgeZone zone, Region region) {
    BigDecimal current = zone.getCurrentMultiplier();
    // Not applied yet: a set override (as the cycle will apply it, clamped to the cap) the cycle
    // has not reached, or a reset whose computed value the cycle has not restored.
    boolean pending =
        current.compareTo(
                surgeCalculator.current(
                    zone.getOverrideMultiplier(),
                    zone.getComputedMultiplier(),
                    zone.getMultiplierCap(),
                    region.getSurgeCap()))
            != 0;
    return new SurgeZoneStateDto(
        zone.getId(),
        zone.getName(),
        GeoJson.toDto(zone.getPolygon()),
        current,
        zone.getComputedMultiplier(),
        zone.getOverrideMultiplier(),
        utc(zone.getOverrideSetAt()),
        pending,
        zone.getDemandCount(),
        zone.getSupplyCount(),
        utc(zone.getComputedAt()));
  }

  private List<ThresholdStepDto> steps(SurgeZone zone) {
    return objectMapper.convertValue(zone.getThresholdSteps(), new TypeReference<>() {});
  }

  private Instant nextCycleAt() {
    return surgeCalculator.nextFire(surgeProperties.cycleCron(), clock.instant());
  }

  private static OffsetDateTime utc(Instant instant) {
    return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
  }
}
