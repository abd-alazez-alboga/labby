package com.labby.backend.service;

import com.labby.backend.dto.SurgeOverrideRequestDto;
import com.labby.backend.dto.SurgeZoneDto;
import com.labby.backend.dto.SurgeZoneUpsertRequestDto;
import java.util.List;
import java.util.UUID;

/**
 * A region's admin-drawn surge zones (PRC-02, UC-A-08): the polygon must lie within the region's
 * boundary, names are unique per region; plus the UC-A-09 manual override, which the surge cycle
 * applies at its next run. Every mutation is audited (RBAC-05, actions {@code surge_zone.*}).
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

  /**
   * Sets a manual multiplier on a zone (UC-A-09). It must not exceed the zone's effective cap (the
   * lower of zone cap and region cap, when set) → 400 otherwise. Pricing picks it up at the next
   * surge cycle.
   *
   * @param actorUserId the acting admin
   * @param surgeZoneId the zone
   * @param request the multiplier
   * @return the zone, override set
   */
  SurgeZoneDto setOverride(UUID actorUserId, UUID surgeZoneId, SurgeOverrideRequestDto request);

  /**
   * Resets a zone to automatic (UC-A-09), effective at the next surge cycle. Resetting a zone
   * without an override changes nothing.
   *
   * @param actorUserId the acting admin
   * @param surgeZoneId the zone
   */
  void resetOverride(UUID actorUserId, UUID surgeZoneId);
}
