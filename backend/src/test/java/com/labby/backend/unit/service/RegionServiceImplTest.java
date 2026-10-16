package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.GeoJsonPolygonDto;
import com.labby.backend.dto.RegionConfigDto;
import com.labby.backend.dto.RegionDto;
import com.labby.backend.dto.RegionUpsertRequestDto;
import com.labby.backend.enums.RegionState;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Region;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.SurgeZoneRepository;
import com.labby.backend.service.AuditService;
import com.labby.backend.service.RegionServiceImpl;
import com.labby.backend.util.GeoJson;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * UC-A-05/06 rules: activation completeness names every missing part (E1), boundaries may not
 * overlap, an active region may not un-fill mandatory config, SD-01 resolution semantics.
 */
@ExtendWith(MockitoExtension.class)
class RegionServiceImplTest {

  private static final UUID ACTOR = UUID.randomUUID();

  private static final List<String> ALL_MANDATORY_PARTS =
      List.of(
          "boundary",
          "currency",
          "emergency number",
          "at least one enabled service type",
          "cancellation values",
          "wait values",
          "pickup-fee values",
          "commission tiers",
          "incentive values",
          "suspension thresholds",
          "surge cap");

  @Mock private RegionRepository regionRepository;
  @Mock private ServiceTypeRepository serviceTypeRepository;
  @Mock private SurgeZoneRepository surgeZoneRepository;
  @Mock private AuditService auditService;

  private RegionServiceImpl service;

  @BeforeEach
  void setUp() {
    service =
        new RegionServiceImpl(
            regionRepository,
            serviceTypeRepository,
            surgeZoneRepository,
            auditService,
            new ObjectMapper());
  }

  private static GeoJsonPolygonDto geoSquare(
      double minLng, double minLat, double maxLng, double maxLat) {
    return new GeoJsonPolygonDto(
        "Polygon",
        List.of(
            List.of(
                List.of(minLng, minLat),
                List.of(maxLng, minLat),
                List.of(maxLng, maxLat),
                List.of(minLng, maxLat),
                List.of(minLng, minLat))));
  }

  private static Region draftWithNameOnly(UUID id) {
    Region region = Region.builder().name("Damascus").build();
    region.setId(id);
    return region;
  }

  private static Region completeRegion(UUID id, RegionState state) {
    Region region =
        Region.builder()
            .name("Damascus")
            .state(state)
            .boundary(GeoJson.toPolygon(geoSquare(36.0, 33.0, 36.5, 33.5)))
            .currency("SYP")
            .emergencyNumber("112")
            .cancellationGraceMin(5)
            .cancellationFee(new BigDecimal("1.00"))
            .waitGraceMin(5)
            .waitPerMinRate(new BigDecimal("0.25"))
            .pickupFeeThresholdKm(new BigDecimal("10.0"))
            .pickupFeePerKm(new BigDecimal("0.50"))
            .surgeCap(new BigDecimal("3.00"))
            .commissionTiers(List.of(Map.of("weeklyTripsAbove", 0, "percent", 25)))
            .incentiveValues(Map.of("peakHourBonusPerTrip", 1.0))
            .suspensionThresholds(
                Map.of("driver", Map.of("minAvgRating", 3.0, "minRatedRides", 20)))
            .build();
    region.setId(id);
    return region;
  }

  private static RegionUpsertRequestDto nameOnlyRequest(String name) {
    return new RegionUpsertRequestDto(
        name, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
        null, null, null);
  }

  @Test
  @DisplayName("activation 409 names every missing mandatory part (UC-A-05 E1)")
  void shouldListEveryMissingPartWhenActivatingEmptyDraft() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId)).thenReturn(Optional.of(draftWithNameOnly(regionId)));
    when(serviceTypeRepository.existsByRegionIdAndEnabledTrue(regionId)).thenReturn(false);

    assertThatThrownBy(() -> service.activateRegion(ACTOR, regionId))
        .isInstanceOf(ConflictException.class)
        .satisfies(
            ex -> ALL_MANDATORY_PARTS.forEach(part -> assertThat(ex).hasMessageContaining(part)));
    verify(regionRepository, never()).save(any());
  }

  @Test
  @DisplayName("a disabled-only service-type catalog still blocks activation")
  void shouldRequireAnEnabledServiceType() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId))
        .thenReturn(Optional.of(completeRegion(regionId, RegionState.DRAFT)));
    when(serviceTypeRepository.existsByRegionIdAndEnabledTrue(regionId)).thenReturn(false);

    assertThatThrownBy(() -> service.activateRegion(ACTOR, regionId))
        .isInstanceOf(ConflictException.class)
        .hasMessageContaining("at least one enabled service type")
        .hasMessageNotContaining("boundary");
  }

  @Test
  @DisplayName("a complete bundle activates and is audited")
  void shouldActivateWhenBundleComplete() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId))
        .thenReturn(Optional.of(completeRegion(regionId, RegionState.DRAFT)));
    when(serviceTypeRepository.existsByRegionIdAndEnabledTrue(regionId)).thenReturn(true);
    when(regionRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

    RegionDto dto = service.activateRegion(ACTOR, regionId);

    assertThat(dto.state()).isEqualTo(RegionState.ACTIVE);
    verify(auditService)
        .record(
            eq(ACTOR), eq("region.activate"), eq("region"), eq(regionId.toString()), any(), any());
  }

  @Test
  @DisplayName("activating an active region is idempotent: no mutation, no audit entry")
  void shouldBeIdempotentWhenAlreadyActive() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId))
        .thenReturn(Optional.of(completeRegion(regionId, RegionState.ACTIVE)));

    RegionDto dto = service.activateRegion(ACTOR, regionId);

    assertThat(dto.state()).isEqualTo(RegionState.ACTIVE);
    verify(regionRepository, never()).save(any());
    verify(auditService, never()).record(any(), any(), any(), any(), any(), any());
  }

  @Test
  @DisplayName("createRegion rejects a duplicate name")
  void shouldRejectCreateWhenNameExists() {
    when(regionRepository.existsByNameIgnoreCase("Damascus")).thenReturn(true);

    assertThatThrownBy(() -> service.createRegion(ACTOR, nameOnlyRequest("Damascus")))
        .isInstanceOf(ResourceAlreadyExistsException.class);
  }

  @Test
  @DisplayName("updateRegion rejects a boundary overlapping another region's (M4-T2 rule)")
  void shouldRejectOverlappingBoundaryOnUpdate() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId))
        .thenReturn(Optional.of(completeRegion(regionId, RegionState.DRAFT)));
    when(regionRepository.existsBoundaryOverlapping(eq(regionId), anyString())).thenReturn(true);
    RegionUpsertRequestDto request =
        new RegionUpsertRequestDto(
            "Damascus",
            geoSquare(36.2, 33.2, 36.8, 33.8),
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null);

    assertThatThrownBy(() -> service.updateRegion(ACTOR, regionId, request))
        .isInstanceOf(ConflictException.class)
        .hasMessageContaining("overlaps");
    verify(regionRepository, never()).save(any());
  }

  @Test
  @DisplayName("an ACTIVE region may not un-fill mandatory config; the 409 names what was cleared")
  void shouldRejectClearingMandatoryConfigOnActiveRegion() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId))
        .thenReturn(Optional.of(completeRegion(regionId, RegionState.ACTIVE)));

    assertThatThrownBy(() -> service.updateRegion(ACTOR, regionId, nameOnlyRequest("Damascus")))
        .isInstanceOf(ConflictException.class)
        .hasMessageContaining("boundary")
        .hasMessageContaining("currency")
        .hasMessageContaining("surge cap");
    verify(regionRepository, never()).save(any());
  }

  @Test
  @DisplayName("resolve rejects out-of-range coordinates with 400")
  void shouldRejectOutOfRangeCoordinates() {
    assertThatThrownBy(() -> service.resolveRegion(90.5, 36.0))
        .isInstanceOf(InvalidRequestException.class)
        .hasMessageContaining("lat");
    assertThatThrownBy(() -> service.resolveRegion(33.0, -180.5))
        .isInstanceOf(InvalidRequestException.class)
        .hasMessageContaining("lng");
  }

  @Test
  @DisplayName("resolve outside every region is 404; a shared border resolves first by name")
  void shouldResolvePerSd01Semantics() {
    when(regionRepository.findActiveRegionsCovering(34.0, 37.0)).thenReturn(List.of());
    assertThatThrownBy(() -> service.resolveRegion(34.0, 37.0))
        .isInstanceOf(ResourceNotFoundException.class);

    Region aleppo = completeRegion(UUID.randomUUID(), RegionState.ACTIVE);
    aleppo.setName("Aleppo");
    Region damascus = completeRegion(UUID.randomUUID(), RegionState.ACTIVE);
    // The repository query orders by name; the service keeps the first hit.
    when(regionRepository.findActiveRegionsCovering(33.0, 36.25))
        .thenReturn(List.of(aleppo, damascus));
    when(serviceTypeRepository.findByRegionIdAndEnabledTrueOrderByNameEnAsc(aleppo.getId()))
        .thenReturn(List.of());

    RegionConfigDto config = service.resolveRegion(33.0, 36.25);

    assertThat(config.id()).isEqualTo(aleppo.getId());
    assertThat(config.name()).isEqualTo("Aleppo");
  }

  @Test
  @DisplayName("the client config endpoint does not serve drafts (404)")
  void shouldHideDraftConfig() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId))
        .thenReturn(Optional.of(completeRegion(regionId, RegionState.DRAFT)));

    assertThatThrownBy(() -> service.getRegionConfig(regionId))
        .isInstanceOf(ResourceNotFoundException.class);
  }
}
