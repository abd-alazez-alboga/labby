package com.labby.backend.service;

import com.labby.backend.dto.SurgeZoneDto;
import com.labby.backend.dto.SurgeZoneUpsertRequestDto;
import java.util.List;
import java.util.UUID;

/**
 * A region's admin-drawn surge zones (PRC-02, UC-A-08): the polygon must lie within the region's
 * boundary, names are unique per region. The multiplier cycle and the UC-A-09 override arrive with
 * M9. Every mutation is audited (RBAC-05, actions {@code surge_zone.*}).
 */
public interface SurgeZoneService {

  /**
   * Lists a region's surge zones.
   *
   * @param regionId the region
   * @return the zones, name-sorted
   */
  List<SurgeZoneDto> listSurgeZones(UUID regionId);

  /**
   * Draws a surge zone (UC-A-08). The polygon must lie within the region's boundary → 409 otherwise
   * (also when the region has no boundary yet); duplicate name per region → 409.
   *
   * @param actorUserId the acting admin
   * @param regionId the region
   * @param request the zone
   * @return the created zone
   */
  SurgeZoneDto createSurgeZone(UUID actorUserId, UUID regionId, SurgeZoneUpsertRequestDto request);

  /**
   * Edits a surge zone (UC-A-08) under the same containment and name rules.
   *
   * @param actorUserId the acting admin
   * @param surgeZoneId the zone
   * @param request the replacement values
   * @return the updated zone
   */
  SurgeZoneDto updateSurgeZone(
      UUID actorUserId, UUID surgeZoneId, SurgeZoneUpsertRequestDto request);

  /**
   * Deletes a surge zone (UC-A-08).
   *
   * @param actorUserId the acting admin
   * @param surgeZoneId the zone
   */
  void deleteSurgeZone(UUID actorUserId, UUID surgeZoneId);
}
