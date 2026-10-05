package com.labby.backend.service;

import com.labby.backend.dto.SurchargeWindowDto;
import com.labby.backend.dto.SurchargeWindowUpsertRequestDto;
import java.util.List;
import java.util.UUID;

/**
 * A region's time-window fare surcharges (PRC-01, e.g. rush +25%). Every mutation is audited
 * (RBAC-05, actions {@code surcharge_window.*}).
 */
public interface SurchargeWindowService {

  /**
   * Lists a region's surcharge windows, ordered by start time.
   *
   * @param regionId the region
   * @return the windows
   */
  List<SurchargeWindowDto> listSurchargeWindows(UUID regionId);

  /**
   * Adds a time-window surcharge (PRC-01).
   *
   * @param actorUserId the acting admin
   * @param regionId the region
   * @param request the window
   * @return the created window
   */
  SurchargeWindowDto createSurchargeWindow(
      UUID actorUserId, UUID regionId, SurchargeWindowUpsertRequestDto request);

  /**
   * Edits a time-window surcharge.
   *
   * @param actorUserId the acting admin
   * @param surchargeWindowId the window
   * @param request the replacement values
   * @return the updated window
   */
  SurchargeWindowDto updateSurchargeWindow(
      UUID actorUserId, UUID surchargeWindowId, SurchargeWindowUpsertRequestDto request);

  /**
   * Deletes a time-window surcharge.
   *
   * @param actorUserId the acting admin
   * @param surchargeWindowId the window
   */
  void deleteSurchargeWindow(UUID actorUserId, UUID surchargeWindowId);
}
