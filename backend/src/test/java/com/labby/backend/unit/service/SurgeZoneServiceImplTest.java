package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.GeoJsonPolygonDto;
import com.labby.backend.dto.SurgeZoneDto;
import com.labby.backend.dto.SurgeZoneUpsertRequestDto;
import com.labby.backend.dto.ThresholdStepDto;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Region;
import com.labby.backend.model.SurgeZone;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.SurgeZoneRepository;
import com.labby.backend.service.AuditService;
import com.labby.backend.service.SurgeZoneServiceImpl;
import com.labby.backend.util.GeoJson;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * UC-A-08 rules: a zone polygon must lie within its region's boundary (no boundary yet -> 409 too),
 * names are unique per region, mutations are audited.
 */
@ExtendWith(MockitoExtension.class)
class SurgeZoneServiceImplTest {

  private static final UUID ACTOR = UUID.randomUUID();

  @Mock private SurgeZoneRepository surgeZoneRepository;
  @Mock private RegionRepository regionRepository;
  @Mock private AuditService auditService;

  private SurgeZoneServiceImpl service;

  @BeforeEach
  void setUp() {
    service =
        new SurgeZoneServiceImpl(
            surgeZoneRepository, regionRepository, auditService, new ObjectMapper());
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

  private static Region region(UUID id, boolean withBoundary) {
    Region region =
        Region.builder()
            .name("Damascus")
            .boundary(withBoundary ? GeoJson.toPolygon(geoSquare(36.0, 33.0, 36.5, 33.5)) : null)
            .build();
    region.setId(id);
    return region;
  }

  private static SurgeZoneUpsertRequestDto request(String name) {
    return new SurgeZoneUpsertRequestDto(
        name,
        geoSquare(36.1, 33.1, 36.2, 33.2),
        List.of(new ThresholdStepDto(new BigDecimal("2"), new BigDecimal("1.2"))),
        null);
  }

  @Test
  @DisplayName("a zone cannot be drawn while the region has no boundary (409)")
  void shouldRejectZoneWhenRegionHasNoBoundary() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId)).thenReturn(Optional.of(region(regionId, false)));

    assertThatThrownBy(() -> service.createSurgeZone(ACTOR, regionId, request("Old City")))
        .isInstanceOf(ConflictException.class)
        .hasMessageContaining("no boundary");
    verify(surgeZoneRepository, never()).save(any());
  }

  @Test
  @DisplayName("a zone polygon outside the region's boundary is rejected (409)")
  void shouldRejectZoneOutsideBoundary() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId)).thenReturn(Optional.of(region(regionId, true)));
    when(regionRepository.boundaryCovers(eq(regionId), anyString())).thenReturn(false);

    assertThatThrownBy(() -> service.createSurgeZone(ACTOR, regionId, request("Old City")))
        .isInstanceOf(ConflictException.class)
        .hasMessageContaining("within the region's boundary");
    verify(surgeZoneRepository, never()).save(any());
  }

  @Test
  @DisplayName("a duplicate zone name in the region is rejected (409)")
  void shouldRejectDuplicateZoneName() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId)).thenReturn(Optional.of(region(regionId, true)));
    when(regionRepository.boundaryCovers(eq(regionId), anyString())).thenReturn(true);
    when(surgeZoneRepository.existsByRegionIdAndNameIgnoreCase(regionId, "Old City"))
        .thenReturn(true);

    assertThatThrownBy(() -> service.createSurgeZone(ACTOR, regionId, request("Old City")))
        .isInstanceOf(ResourceAlreadyExistsException.class);
  }

  @Test
  @DisplayName("a contained zone is created, audited, and round-trips its polygon")
  void shouldCreateZoneAndAudit() {
    UUID regionId = UUID.randomUUID();
    when(regionRepository.findById(regionId)).thenReturn(Optional.of(region(regionId, true)));
    when(regionRepository.boundaryCovers(eq(regionId), anyString())).thenReturn(true);
    when(surgeZoneRepository.existsByRegionIdAndNameIgnoreCase(regionId, "Old City"))
        .thenReturn(false);
    when(surgeZoneRepository.save(any()))
        .thenAnswer(
            invocation -> {
              SurgeZone saved = invocation.getArgument(0);
              saved.setId(UUID.randomUUID());
              return saved;
            });

    SurgeZoneDto dto = service.createSurgeZone(ACTOR, regionId, request("Old City"));

    assertThat(dto.name()).isEqualTo("Old City");
    assertThat(dto.polygon()).isEqualTo(geoSquare(36.1, 33.1, 36.2, 33.2));
    assertThat(dto.thresholdSteps()).hasSize(1);
    assertThat(dto.overrideMultiplier()).isNull();
    verify(auditService)
        .record(
            eq(ACTOR),
            eq("surge_zone.create"),
            eq("surge_zone"),
            eq(dto.id().toString()),
            isNull(),
            any());
  }

  @Test
  @DisplayName("editing a zone re-checks containment against its region")
  void shouldRejectUpdateOutsideBoundary() {
    UUID regionId = UUID.randomUUID();
    UUID zoneId = UUID.randomUUID();
    SurgeZone zone =
        SurgeZone.builder()
            .regionId(regionId)
            .name("Old City")
            .polygon(GeoJson.toPolygon(geoSquare(36.1, 33.1, 36.2, 33.2)))
            .thresholdSteps(List.of())
            .build();
    zone.setId(zoneId);
    when(surgeZoneRepository.findById(zoneId)).thenReturn(Optional.of(zone));
    when(regionRepository.findById(regionId)).thenReturn(Optional.of(region(regionId, true)));
    when(regionRepository.boundaryCovers(eq(regionId), anyString())).thenReturn(false);

    assertThatThrownBy(() -> service.updateSurgeZone(ACTOR, zoneId, request("Old City")))
        .isInstanceOf(ConflictException.class)
        .hasMessageContaining("within the region's boundary");
  }

  @Test
  @DisplayName("deleting an unknown zone is 404; a real delete is audited with its before state")
  void shouldDeleteZoneAndAudit() {
    UUID missing = UUID.randomUUID();
    when(surgeZoneRepository.findById(missing)).thenReturn(Optional.empty());
    assertThatThrownBy(() -> service.deleteSurgeZone(ACTOR, missing))
        .isInstanceOf(ResourceNotFoundException.class);

    UUID zoneId = UUID.randomUUID();
    SurgeZone zone =
        SurgeZone.builder()
            .regionId(UUID.randomUUID())
            .name("Old City")
            .polygon(GeoJson.toPolygon(geoSquare(36.1, 33.1, 36.2, 33.2)))
            .thresholdSteps(List.of())
            .build();
    zone.setId(zoneId);
    when(surgeZoneRepository.findById(zoneId)).thenReturn(Optional.of(zone));

    service.deleteSurgeZone(ACTOR, zoneId);

    verify(surgeZoneRepository).delete(zone);
    verify(auditService)
        .record(
            eq(ACTOR),
            eq("surge_zone.delete"),
            eq("surge_zone"),
            eq(zoneId.toString()),
            any(),
            isNull());
  }
}
