package com.labby.backend.service;

import com.labby.backend.dto.HeatmapDto;
import com.labby.backend.dto.SurgeStateDto;
import java.util.UUID;

/**
 * The surge cycle and its read models (PRC-02, DRV-09, UC-A-09, UC-D-14): every cycle recomputes
 * each zone of an active region from demand (open requests) and supply (idle online drivers) and
 * stores the multiplier pricing reads until the next cycle.
 */
public interface SurgeService {

  /**
   * One surge cycle (run by {@link SurgeCycleJob}). Each zone is computed in its own transaction
   * under a SKIP LOCKED row lock, so concurrent instances never process the same zone at once; the
   * result depends only on the live inputs, so re-running is harmless. Zones of draft regions keep
   * their last state.
   *
   * @return how many zones this run processed
   */
  int recompute();

  /**
   * A region's live surge state for the admin (UC-A-09): cap, next cycle, per-zone multipliers,
   * override state and the last cycle's counts.
   *
   * @param regionId the region
   * @return the state
   */
  SurgeStateDto surgeState(UUID regionId);

  /**
   * The driver's demand heatmap (DRV-09, UC-D-14): the zones of their operating region with the
   * current multiplier and level — no raw counts. No operating region yet → 404 {@code
   * no_operating_region}.
   *
   * @param driverUserId the approved driver
   * @return the heatmap
   */
  HeatmapDto heatmap(UUID driverUserId);
}
