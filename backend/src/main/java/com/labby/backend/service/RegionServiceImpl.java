package com.labby.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.CommissionTierDto;
import com.labby.backend.dto.GrowthSettingsDto;
import com.labby.backend.dto.IncentiveValuesDto;
import com.labby.backend.dto.MetricWarningsDto;
import com.labby.backend.dto.PeakWindowDto;
import com.labby.backend.dto.RegionConfigDto;
import com.labby.backend.dto.RegionDto;
import com.labby.backend.dto.RegionSummaryDto;
import com.labby.backend.dto.RegionUpsertRequestDto;
import com.labby.backend.dto.ScheduledSettingsDto;
import com.labby.backend.dto.ServiceTypeDto;
import com.labby.backend.dto.SuspensionThresholdDto;
import com.labby.backend.dto.SuspensionThresholdsDto;
import com.labby.backend.enums.RegionState;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.FieldValidationException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Region;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.SurgeZone;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.SurgeZoneRepository;
import com.labby.backend.util.GeoJson;
import java.time.DateTimeException;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.locationtech.jts.geom.Polygon;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Region lifecycle per UC-A-05/06: drafts may be incomplete, activation requires the full mandatory
 * bundle (E1 lists what is missing), boundaries may not overlap another region's. Every mutation is
 * audited (RBAC-05, actions {@code region.*}).
 */
@Service
@RequiredArgsConstructor
public class RegionServiceImpl implements RegionService {

  private static final String TARGET_TYPE_REGION = "region";

  /** Create-time placeholder for the overlap query's self-exclusion (no own id yet). */
  private static final UUID NO_REGION_ID = new UUID(0L, 0L);

  private final RegionRepository regionRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final SurgeZoneRepository surgeZoneRepository;
  private final AuditService auditService;
  private final ObjectMapper objectMapper;

  @Override
  @Transactional(readOnly = true)
  public List<RegionSummaryDto> listRegions() {
    return regionRepository.findAllByOrderByNameAsc().stream().map(this::toSummaryDto).toList();
  }

  @Override
  @Transactional(readOnly = true)
  public RegionDto getRegion(UUID regionId) {
    return toDto(requireRegion(regionId));
  }

  @Override
  @Transactional
  public RegionDto createRegion(UUID actorUserId, RegionUpsertRequestDto request) {
    if (regionRepository.existsByNameIgnoreCase(request.name())) {
      throw new ResourceAlreadyExistsException("Region", "name", request.name())
          .withCode("region_name_taken");
    }
    Polygon boundary = GeoJson.toPolygon(request.boundary());
    requireNoBoundaryOverlap(NO_REGION_ID, boundary);
    Region region = Region.builder().createdBy(actorUserId).build();
    applyBundle(region, request, boundary, actorUserId);
    Region saved = regionRepository.save(region);
    auditService.record(
        actorUserId,
        "region.create",
        TARGET_TYPE_REGION,
        saved.getId().toString(),
        null,
        snapshot(saved));
    return toDto(saved);
  }

  @Override
  @Transactional
  public RegionDto updateRegion(UUID actorUserId, UUID regionId, RegionUpsertRequestDto request) {
    Region region = requireRegion(regionId);
    if (!request.name().equalsIgnoreCase(region.getName())
        && regionRepository.existsByNameIgnoreCase(request.name())) {
      throw new ResourceAlreadyExistsException("Region", "name", request.name())
          .withCode("region_name_taken");
    }
    Polygon boundary = GeoJson.toPolygon(request.boundary());
    requireNoBoundaryOverlap(regionId, boundary);
    requireZonesInside(regionId, boundary);
    Map<String, Object> before = snapshot(region);
    applyBundle(region, request, boundary, actorUserId);
    if (region.getState() == RegionState.ACTIVE) {
      // UC-A-06: an active region may not un-fill mandatory config. The service-type part is not
      // carried by this payload, so only the bundle parts are checked here.
      List<String> missing = missingBundleParts(region);
      if (!missing.isEmpty()) {
        throw new ConflictException(
                "An active region cannot clear mandatory config; missing: "
                    + String.join(", ", missing))
            .withCode("active_region_incomplete")
            .withDetail("missing", missing);
      }
    }
    Region saved = regionRepository.save(region);
    auditService.record(
        actorUserId,
        "region.update",
        TARGET_TYPE_REGION,
        saved.getId().toString(),
        before,
        snapshot(saved));
    return toDto(saved);
  }

  @Override
  @Transactional
  public RegionDto activateRegion(UUID actorUserId, UUID regionId) {
    Region region = requireRegion(regionId);
    if (region.getState() == RegionState.ACTIVE) {
      return toDto(region); // Idempotent: already active, nothing to mutate or audit.
    }
    List<String> missing = missingMandatoryParts(region);
    if (!missing.isEmpty()) {
      throw new ConflictException(
              "The region cannot be activated; missing: " + String.join(", ", missing))
          .withCode("region_incomplete")
          .withDetail("missing", missing);
    }
    Map<String, Object> before = snapshot(region);
    region.setState(RegionState.ACTIVE);
    region.setUpdatedBy(actorUserId);
    Region saved = regionRepository.save(region);
    auditService.record(
        actorUserId,
        "region.activate",
        TARGET_TYPE_REGION,
        saved.getId().toString(),
        before,
        snapshot(saved));
    return toDto(saved);
  }

  @Override
  @Transactional(readOnly = true)
  public RegionConfigDto resolveRegion(double lat, double lng) {
    if (lat < -90 || lat > 90) {
      throw new InvalidRequestException("lat must be within [-90, 90]");
    }
    if (lng < -180 || lng > 180) {
      throw new InvalidRequestException("lng must be within [-180, 180]");
    }
    List<Region> covering = regionRepository.findActiveRegionsCovering(lat, lng);
    if (covering.isEmpty()) {
      throw new ResourceNotFoundException("No operating region covers this location");
    }
    // Boundaries may not overlap; multiple hits can only be a shared border — first by name wins.
    return toConfigDto(covering.get(0));
  }

  @Override
  @Transactional(readOnly = true)
  public RegionConfigDto getRegionConfig(UUID regionId) {
    Region region = requireRegion(regionId);
    if (region.getState() != RegionState.ACTIVE) {
      throw new ResourceNotFoundException("Region", regionId); // Drafts are not served (SD-01).
    }
    return toConfigDto(region);
  }

  private Region requireRegion(UUID regionId) {
    return regionRepository
        .findById(regionId)
        .orElseThrow(() -> new ResourceNotFoundException("Region", regionId));
  }

  private void requireNoBoundaryOverlap(UUID excludedRegionId, Polygon boundary) {
    if (boundary != null
        && regionRepository.existsBoundaryOverlapping(excludedRegionId, boundary.toText())) {
      throw new ConflictException("The boundary overlaps another region's boundary")
          .withCode("boundary_overlap");
    }
  }

  /**
   * A boundary edit may not leave a surge zone outside its region (owner ruling 2026-10-07, UC-A-06
   * E1): dead zones would silently break M9 surge. Clearing the boundary escapes every zone.
   */
  private void requireZonesInside(UUID regionId, Polygon boundary) {
    List<String> outside =
        boundary == null
            ? surgeZoneRepository.findByRegionIdOrderByNameAsc(regionId).stream()
                .map(SurgeZone::getName)
                .toList()
            : surgeZoneRepository.findZoneNamesOutside(regionId, boundary.toText());
    if (!outside.isEmpty()) {
      throw new ConflictException(
              "The boundary would leave surge zones outside the region; move or delete them"
                  + " first: "
                  + String.join(", ", outside))
          .withCode("zones_outside_boundary")
          .withDetail("zoneNames", outside);
    }
  }

  /**
   * The requested IANA zone, or the region's current one when omitted (a client that leaves the
   * field out must not reset a zone set elsewhere — M7 audit W1; the dashboard edits it since
   * review V1 I23); an unknown id is a 400. New regions start at {@link Region#DEFAULT_TIME_ZONE}.
   */
  private static String timeZone(String requested, String current) {
    if (requested == null) {
      return current;
    }
    try {
      return ZoneId.of(requested).getId();
    } catch (DateTimeException ex) {
      throw new InvalidRequestException("timeZone must be a known IANA time zone id");
    }
  }

  private void applyBundle(
      Region region, RegionUpsertRequestDto request, Polygon boundary, UUID actorUserId) {
    requireValidTrustConfig(request);
    region.setName(request.name());
    region.setBoundary(boundary);
    region.setCurrency(request.currency());
    region.setEmergencyNumber(request.emergencyNumber());
    region.setTimeZone(timeZone(request.timeZone(), region.getTimeZone()));
    region.setCancellationGraceMin(request.cancellationGraceMin());
    region.setCancellationFee(request.cancellationFee());
    region.setWaitGraceMin(request.waitGraceMin());
    region.setWaitPerMinRate(request.waitPerMinRate());
    region.setPickupFeeThresholdKm(request.pickupFeeThresholdKm());
    region.setPickupFeePerKm(request.pickupFeePerKm());
    region.setSurgeCap(request.surgeCap());
    // Like timeZone (M8 audit H1): an omitted/null floor keeps the stored one (a client without the
    // field must not reset it); a new region starts NULL (= the SRS default -50).
    if (request.driverBalanceFloor() != null) {
      region.setDriverBalanceFloor(request.driverBalanceFloor());
    }
    // Review V1 W3 (owner ruling 2026-10-20): the per-region warning margin follows the same
    // keep-on-omit rule; NULL = the global MONEY_FLOOR_WARNING_MARGIN.
    if (request.floorWarningMargin() != null) {
      region.setFloorWarningMargin(request.floorWarningMargin());
    }
    region.setCommissionTiers(
        request.commissionTiers() == null
            ? null
            : objectMapper.convertValue(request.commissionTiers(), new TypeReference<>() {}));
    requireValidPeakWindows(request.incentiveValues());
    region.setIncentiveValues(
        request.incentiveValues() == null
            ? null
            : objectMapper.convertValue(request.incentiveValues(), new TypeReference<>() {}));
    region.setSuspensionThresholds(
        request.suspensionThresholds() == null
            ? null
            : objectMapper.convertValue(request.suspensionThresholds(), new TypeReference<>() {}));
    // M11 DRV-07: like the floor, omitted/null keeps the stored value; a new region starts NULL
    // (= the SRS defaults 50 / 15 / 30 days / 20).
    if (request.metricWarnings() != null) {
      region.setMetricWarnings(
          objectMapper.convertValue(request.metricWarnings(), new TypeReference<>() {}));
    }
    // M12 RIDE-S timing: same keep-on-omit rule; a new region starts NULL (= 1440 / 60 / 15 / 30).
    if (request.scheduledSettings() != null) {
      region.setScheduledSettings(
          objectMapper.convertValue(request.scheduledSettings(), new TypeReference<>() {}));
    }
    // M13 growth knobs (ruling 4): same keep-on-omit rule; NULL = GrowthRules.DEFAULTS.
    if (request.growthSettings() != null) {
      region.setGrowthSettings(
          objectMapper.convertValue(request.growthSettings(), new TypeReference<>() {}));
    }
    region.setUpdatedBy(actorUserId);
  }

  /**
   * M11 trust config and M12 timing rules the annotations cannot express: a RATE-03 {@code
   * warnAvgRating} must be above its role's {@code minAvgRating}; DRV-07 {@code windowDays} is 7 or
   * 30; the scheduled tiers are ordered (ScheduledRules#ordered).
   */
  private static void requireValidTrustConfig(RegionUpsertRequestDto request) {
    Map<String, String> errors = new LinkedHashMap<>();
    SuspensionThresholdsDto thresholds = request.suspensionThresholds();
    if (thresholds != null) {
      requireWarnAboveMin("suspensionThresholds.driver", thresholds.driver(), errors);
      requireWarnAboveMin("suspensionThresholds.rider", thresholds.rider(), errors);
    }
    MetricWarningsDto metricWarnings = request.metricWarnings();
    if (metricWarnings != null
        && metricWarnings.windowDays() != null
        && metricWarnings.windowDays() != 7
        && metricWarnings.windowDays() != 30) {
      errors.put("metricWarnings.windowDays", "must be 7 or 30");
    }
    ScheduledSettingsDto scheduled = request.scheduledSettings();
    if (scheduled != null
        && scheduled.reminderFirstMin() != null
        && scheduled.reminderSecondMin() != null
        && scheduled.fallbackLeadMin() != null
        && scheduled.minLeadMin() != null
        && !ScheduledRules.ordered(
            new ScheduledRules.Settings(
                scheduled.reminderFirstMin(),
                scheduled.reminderSecondMin(),
                scheduled.fallbackLeadMin(),
                scheduled.minLeadMin()))) {
      errors.put(
          "scheduledSettings",
          "must satisfy reminderFirstMin > reminderSecondMin > fallbackLeadMin and minLeadMin >"
              + " fallbackLeadMin");
    }
    if (!errors.isEmpty()) {
      throw new FieldValidationException(errors);
    }
  }

  private static void requireWarnAboveMin(
      String field, SuspensionThresholdDto threshold, Map<String, String> errors) {
    if (threshold != null
        && threshold.warnAvgRating() != null
        && threshold.minAvgRating() != null
        && threshold.warnAvgRating().compareTo(threshold.minAvgRating()) <= 0) {
      errors.put(field + ".warnAvgRating", "must be greater than minAvgRating");
    }
  }

  /** The complete activation checklist (UC-A-05 E1), including the service-type part. */
  private List<String> missingMandatoryParts(Region region) {
    List<String> missing = new ArrayList<>();
    if (region.getBoundary() == null) {
      missing.add("boundary");
    }
    if (isBlank(region.getCurrency())) {
      missing.add("currency");
    }
    if (isBlank(region.getEmergencyNumber())) {
      missing.add("emergency number");
    }
    if (!serviceTypeRepository.existsByRegionIdAndEnabledTrue(region.getId())) {
      missing.add("at least one enabled service type");
    }
    missing.addAll(bundleValueParts(region));
    return missing;
  }

  /** The bundle-only parts (what a PUT payload carries) — the update guard for active regions. */
  private List<String> missingBundleParts(Region region) {
    List<String> missing = new ArrayList<>();
    if (region.getBoundary() == null) {
      missing.add("boundary");
    }
    if (isBlank(region.getCurrency())) {
      missing.add("currency");
    }
    if (isBlank(region.getEmergencyNumber())) {
      missing.add("emergency number");
    }
    missing.addAll(bundleValueParts(region));
    return missing;
  }

  private List<String> bundleValueParts(Region region) {
    List<String> missing = new ArrayList<>();
    if (region.getCancellationGraceMin() == null || region.getCancellationFee() == null) {
      missing.add("cancellation values");
    }
    if (region.getWaitGraceMin() == null || region.getWaitPerMinRate() == null) {
      missing.add("wait values");
    }
    if (region.getPickupFeeThresholdKm() == null || region.getPickupFeePerKm() == null) {
      missing.add("pickup-fee values");
    }
    if (region.getCommissionTiers() == null || region.getCommissionTiers().isEmpty()) {
      missing.add("commission tiers");
    }
    if (region.getIncentiveValues() == null || region.getIncentiveValues().isEmpty()) {
      missing.add("incentive values");
    }
    if (region.getSuspensionThresholds() == null || region.getSuspensionThresholds().isEmpty()) {
      missing.add("suspension thresholds");
    }
    if (region.getSurgeCap() == null) {
      missing.add("surge cap");
    }
    return missing;
  }

  private static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }

  private RegionSummaryDto toSummaryDto(Region region) {
    return new RegionSummaryDto(
        region.getId(), region.getName(), region.getState(), region.getCurrency());
  }

  private RegionDto toDto(Region region) {
    return new RegionDto(
        region.getId(),
        region.getName(),
        region.getState(),
        GeoJson.toDto(region.getBoundary()),
        region.getCurrency(),
        region.getEmergencyNumber(),
        region.getTimeZone(),
        region.getCancellationGraceMin(),
        region.getCancellationFee(),
        region.getWaitGraceMin(),
        region.getWaitPerMinRate(),
        region.getPickupFeeThresholdKm(),
        region.getPickupFeePerKm(),
        region.getSurgeCap(),
        region.getDriverBalanceFloor(),
        region.getFloorWarningMargin(),
        region.getCommissionTiers() == null
            ? null
            : objectMapper.convertValue(
                region.getCommissionTiers(), new TypeReference<List<CommissionTierDto>>() {}),
        region.getIncentiveValues() == null
            ? null
            : objectMapper.convertValue(region.getIncentiveValues(), IncentiveValuesDto.class),
        region.getSuspensionThresholds() == null
            ? null
            : objectMapper.convertValue(
                region.getSuspensionThresholds(), SuspensionThresholdsDto.class),
        region.getMetricWarnings() == null
            ? null
            : objectMapper.convertValue(region.getMetricWarnings(), MetricWarningsDto.class),
        region.getScheduledSettings() == null
            ? null
            : objectMapper.convertValue(region.getScheduledSettings(), ScheduledSettingsDto.class),
        region.getGrowthSettings() == null
            ? null
            : objectMapper.convertValue(region.getGrowthSettings(), GrowthSettingsDto.class),
        serviceTypeRepository.countByRegionId(region.getId()),
        surgeZoneRepository.countByRegionId(region.getId()));
  }

  private RegionConfigDto toConfigDto(Region region) {
    List<ServiceTypeDto> serviceTypes =
        serviceTypeRepository.findByRegionIdAndEnabledTrueOrderByNameEnAsc(region.getId()).stream()
            .map(this::toServiceTypeDto)
            .toList();
    return new RegionConfigDto(
        region.getId(),
        region.getName(),
        region.getCurrency(),
        region.getEmergencyNumber(),
        region.getWaitGraceMin(),
        region.getWaitPerMinRate(),
        serviceTypes);
  }

  private ServiceTypeDto toServiceTypeDto(ServiceType serviceType) {
    return new ServiceTypeDto(
        serviceType.getId(),
        serviceType.getRegionId(),
        serviceType.getNameEn(),
        serviceType.getNameAr(),
        serviceType.getBaseFare(),
        serviceType.getPerKmRate(),
        serviceType.getPerMinRate(),
        serviceType.getMinimumFare(),
        serviceType.isEnabled());
  }

  /** Readable audit snapshot: scalars as-is, the boundary in compact form (RBAC-05). */
  private Map<String, Object> snapshot(Region region) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("name", region.getName());
    snapshot.put("state", region.getState().getValue());
    snapshot.put("boundary", GeoJson.compact(region.getBoundary()));
    snapshot.put("currency", region.getCurrency());
    snapshot.put("emergencyNumber", region.getEmergencyNumber());
    snapshot.put("timeZone", region.getTimeZone());
    snapshot.put("cancellationGraceMin", region.getCancellationGraceMin());
    snapshot.put("cancellationFee", region.getCancellationFee());
    snapshot.put("waitGraceMin", region.getWaitGraceMin());
    snapshot.put("waitPerMinRate", region.getWaitPerMinRate());
    snapshot.put("pickupFeeThresholdKm", region.getPickupFeeThresholdKm());
    snapshot.put("pickupFeePerKm", region.getPickupFeePerKm());
    snapshot.put("surgeCap", region.getSurgeCap());
    snapshot.put("driverBalanceFloor", region.getDriverBalanceFloor());
    snapshot.put("floorWarningMargin", region.getFloorWarningMargin());
    snapshot.put("commissionTiers", region.getCommissionTiers());
    snapshot.put("incentiveValues", region.getIncentiveValues());
    snapshot.put("suspensionThresholds", region.getSuspensionThresholds());
    snapshot.put("metricWarnings", region.getMetricWarnings());
    snapshot.put("scheduledSettings", region.getScheduledSettings());
    snapshot.put("growthSettings", region.getGrowthSettings());
    return snapshot;
  }

  /**
   * M15-T3 (incentives-v1 ruling Q1): a peak-hour bonus above 0 needs at least one window, and a
   * window's start and end differ (an equal pair would read as the whole day).
   */
  private static void requireValidPeakWindows(IncentiveValuesDto incentives) {
    if (incentives == null) {
      return;
    }
    List<PeakWindowDto> windows =
        incentives.peakWindows() == null ? List.of() : incentives.peakWindows();
    for (PeakWindowDto window : windows) {
      if (window.startsAt().equals(window.endsAt())) {
        throw new InvalidRequestException("A peak window's start and end must differ")
            .withCode("peak_window_invalid");
      }
    }
    if (incentives.peakHourBonusPerTrip().signum() > 0 && windows.isEmpty()) {
      throw new InvalidRequestException("A peak-hour bonus above 0 needs at least one window")
          .withCode("peak_windows_required");
    }
  }
}
