package com.labby.backend.service;

import com.labby.backend.dto.RegionConfigDto;
import com.labby.backend.dto.RegionDto;
import com.labby.backend.dto.RegionSummaryDto;
import com.labby.backend.dto.RegionUpsertRequestDto;
import java.util.List;
import java.util.UUID;

/**
 * Region lifecycle and config bundle (ADM-01, SD-01, UC-A-05/06): draft until the mandatory bundle
 * is complete, then activated. Every admin mutation is audited (RBAC-05).
 *
 * <p>In-flight rule (UC-A-06): config edits apply to NEW rides only — nothing here mutates rides,
 * and once rides exist (M7+) they lock their fare inputs at request time (PRC-02/PRC-04), so an
 * edited bundle is only ever read for rides requested after the edit. No ride-side code is needed
 * in M4; this contract note is the anchor for the M7 fare engine.
 */
public interface RegionService {

  /**
   * Lists all regions, name-sorted.
   *
   * @return the summaries
   */
  List<RegionSummaryDto> listRegions();

  /**
   * Reads one region's full config bundle.
   *
   * @param regionId the region
   * @return the bundle
   */
  RegionDto getRegion(UUID regionId);

  /**
   * Creates a draft region (UC-A-05) — only the name is mandatory at creation.
   *
   * @param actorUserId the acting admin
   * @param request the bundle (optional parts may be null)
   * @return the created draft
   */
  RegionDto createRegion(UUID actorUserId, RegionUpsertRequestDto request);

  /**
   * Full-bundle replace (UC-A-06): absent optional fields clear. An ACTIVE region may not un-fill
   * mandatory config (409); a boundary overlapping another region is rejected (409).
   *
   * @param actorUserId the acting admin
   * @param regionId the region
   * @param request the replacement bundle
   * @return the updated region
   */
  RegionDto updateRegion(UUID actorUserId, UUID regionId, RegionUpsertRequestDto request);

  /**
   * Activates a region (UC-A-05 step 5). Allowed only when the mandatory bundle is complete;
   * incomplete → 409 listing the missing parts (E1). Idempotent on an active region.
   *
   * @param actorUserId the acting admin
   * @param regionId the region
   * @return the active region
   */
  RegionDto activateRegion(UUID actorUserId, UUID regionId);

  /**
   * Resolves the ACTIVE region covering a GPS point (SD-01). A point on the boundary line counts as
   * inside; on a shared border the first region by name wins; no covering region → 404.
   *
   * @param lat latitude in [-90, 90]
   * @param lng longitude in [-180, 180]
   * @return the covering region's client config
   */
  RegionConfigDto resolveRegion(double lat, double lng);

  /**
   * Reads a region's client config (SD-01): currency, emergency number and ENABLED service types.
   * Draft regions are not served (404).
   *
   * @param regionId the region
   * @return the client config
   */
  RegionConfigDto getRegionConfig(UUID regionId);
}
