package com.labby.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.SurgeOverrideRequestDto;
import com.labby.backend.dto.SurgeZoneDto;
import com.labby.backend.dto.SurgeZoneUpsertRequestDto;
import com.labby.backend.dto.ThresholdStepDto;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Region;
import com.labby.backend.model.SurgeZone;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.SurgeZoneRepository;
import com.labby.backend.util.GeoJson;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.locationtech.jts.geom.Polygon;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Surge-zone CRUD per UC-A-08: zones belong to exactly one region and must lie within its boundary
 * (ST_Covers). The config upsert never touches the override or the cycle state (read-only on the
 * entity); the UC-A-09 override is written by its own targeted update and only reaches pricing at
 * the next surge cycle. Every mutation is audited (RBAC-05).
 */
@Service
@RequiredArgsConstructor
public class SurgeZoneServiceImpl implements SurgeZoneService {

  private static final String TARGET_TYPE_SURGE_ZONE = "surge_zone";

  private final SurgeZoneRepository surgeZoneRepository;
  private final RegionRepository regionRepository;
  private final AuditService auditService;
  private final ObjectMapper objectMapper;
  private final SurgeCalculator surgeCalculator;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public List<SurgeZoneDto> listSurgeZones(UUID regionId) {
    requireRegion(regionId);
    return surgeZoneRepository.findByRegionIdOrderByNameAsc(regionId).stream()
        .map(this::toDto)
        .toList();
  }

  @Override
  @Transactional
  public SurgeZoneDto createSurgeZone(
      UUID actorUserId, UUID regionId, SurgeZoneUpsertRequestDto request) {
    Region region = requireRegion(regionId);
    Polygon polygon = GeoJson.toPolygon(request.polygon());
    requireWithinBoundary(region, polygon);
    if (surgeZoneRepository.existsByRegionIdAndNameIgnoreCase(regionId, request.name())) {
      throw new ResourceAlreadyExistsException("Surge zone", "name", request.name());
    }
    SurgeZone zone = SurgeZone.builder().regionId(regionId).createdBy(actorUserId).build();
    apply(zone, request, polygon, actorUserId);
    SurgeZone saved = surgeZoneRepository.save(zone);
    auditService.record(
        actorUserId,
        "surge_zone.create",
        TARGET_TYPE_SURGE_ZONE,
        saved.getId().toString(),
        null,
        snapshot(saved));
    return toDto(saved);
  }

  @Override
  @Transactional
  public SurgeZoneDto updateSurgeZone(
      UUID actorUserId, UUID surgeZoneId, SurgeZoneUpsertRequestDto request) {
    SurgeZone zone = requireZone(surgeZoneId);
    Region region = requireRegion(zone.getRegionId());
    Polygon polygon = GeoJson.toPolygon(request.polygon());
    requireWithinBoundary(region, polygon);
    if (surgeZoneRepository.existsByRegionIdAndNameIgnoreCaseAndIdNot(
        zone.getRegionId(), request.name(), surgeZoneId)) {
      throw new ResourceAlreadyExistsException("Surge zone", "name", request.name());
    }
    Map<String, Object> before = snapshot(zone);
    apply(zone, request, polygon, actorUserId);
    SurgeZone saved = surgeZoneRepository.save(zone);
    auditService.record(
        actorUserId,
        "surge_zone.update",
        TARGET_TYPE_SURGE_ZONE,
        saved.getId().toString(),
        before,
        snapshot(saved));
    return toDto(saved);
  }

  @Override
  @Transactional
  public void deleteSurgeZone(UUID actorUserId, UUID surgeZoneId) {
    SurgeZone zone = requireZone(surgeZoneId);
    Map<String, Object> before = snapshot(zone);
    surgeZoneRepository.delete(zone);
    auditService.record(
        actorUserId,
        "surge_zone.delete",
        TARGET_TYPE_SURGE_ZONE,
        surgeZoneId.toString(),
        before,
        null);
  }

  @Override
  @Transactional
  public SurgeZoneDto setOverride(
      UUID actorUserId, UUID surgeZoneId, SurgeOverrideRequestDto request) {
    SurgeZone zone = requireZone(surgeZoneId);
    Region region = requireRegion(zone.getRegionId());
    BigDecimal cap = surgeCalculator.effectiveCap(zone.getMultiplierCap(), region.getSurgeCap());
    if (cap != null && request.multiplier().compareTo(cap) > 0) {
      throw new InvalidRequestException(
              "The override may not exceed the zone's surge cap of " + cap.toPlainString())
          .withCode("override_above_cap")
          .withDetail("cap", cap);
    }
    Map<String, Object> before = overrideSnapshot(zone.getOverrideMultiplier());
    Instant now = clock.instant();
    surgeZoneRepository.setOverride(surgeZoneId, request.multiplier(), actorUserId, now);
    auditService.record(
        actorUserId,
        "surge_zone.override_set",
        TARGET_TYPE_SURGE_ZONE,
        surgeZoneId.toString(),
        before,
        overrideSnapshot(request.multiplier()));
    return toDto(requireZone(surgeZoneId));
  }

  @Override
  @Transactional
  public void resetOverride(UUID actorUserId, UUID surgeZoneId) {
    SurgeZone zone = requireZone(surgeZoneId);
    if (zone.getOverrideMultiplier() == null) {
      return;
    }
    Map<String, Object> before = overrideSnapshot(zone.getOverrideMultiplier());
    surgeZoneRepository.clearOverride(surgeZoneId);
    auditService.record(
        actorUserId,
        "surge_zone.override_reset",
        TARGET_TYPE_SURGE_ZONE,
        surgeZoneId.toString(),
        before,
        overrideSnapshot(null));
  }

  private Region requireRegion(UUID regionId) {
    return regionRepository
        .findById(regionId)
        .orElseThrow(() -> new ResourceNotFoundException("Region", regionId));
  }

  private SurgeZone requireZone(UUID surgeZoneId) {
    return surgeZoneRepository
        .findById(surgeZoneId)
        .orElseThrow(() -> new ResourceNotFoundException("Surge zone", surgeZoneId));
  }

  /** M4-T2 rule: the zone polygon must lie within the region's boundary (ST_Covers). */
  private void requireWithinBoundary(Region region, Polygon polygon) {
    if (region.getBoundary() == null) {
      throw new ConflictException(
          "The region has no boundary yet; draw the boundary before adding surge zones");
    }
    if (!regionRepository.boundaryCovers(region.getId(), polygon.toText())) {
      throw new ConflictException("The zone polygon must lie within the region's boundary");
    }
  }

  private void apply(
      SurgeZone zone, SurgeZoneUpsertRequestDto request, Polygon polygon, UUID actor) {
    zone.setName(request.name());
    zone.setPolygon(polygon);
    zone.setThresholdSteps(
        objectMapper.convertValue(request.thresholdSteps(), new TypeReference<>() {}));
    zone.setMultiplierCap(request.multiplierCap());
    zone.setUpdatedBy(actor);
  }

  private SurgeZoneDto toDto(SurgeZone zone) {
    return new SurgeZoneDto(
        zone.getId(),
        zone.getRegionId(),
        zone.getName(),
        GeoJson.toDto(zone.getPolygon()),
        objectMapper.convertValue(
            zone.getThresholdSteps(), new TypeReference<List<ThresholdStepDto>>() {}),
        zone.getMultiplierCap(),
        zone.getOverrideMultiplier(),
        zone.getOverrideSetAt() == null ? null : zone.getOverrideSetAt().atOffset(ZoneOffset.UTC));
  }

  /** UC-A-09 audit snapshot: the override (null = automatic). */
  private static Map<String, Object> overrideSnapshot(BigDecimal overrideMultiplier) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("overrideMultiplier", overrideMultiplier);
    return snapshot;
  }

  /** Readable audit snapshot: the polygon in compact form (RBAC-05). */
  private Map<String, Object> snapshot(SurgeZone zone) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("name", zone.getName());
    snapshot.put("polygon", GeoJson.compact(zone.getPolygon()));
    snapshot.put("thresholdSteps", zone.getThresholdSteps());
    snapshot.put("multiplierCap", zone.getMultiplierCap());
    return snapshot;
  }
}
