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
   * One surge cycle (run by {@link SurgeCycleJob}). Zones of non-active regions are first reset to
   * no surge (counts 0, override kept), so a reactivated region never prices a stale surge. Each
   * active zone is then computed in its own transaction under a SKIP LOCKED row lock, so concurrent
   * instances never process the same zone at once; with the cycle cron enabled a zone another
   * instance already computed in this cycle (since half a period ago) is skipped too (NFR-P4). The
   * result depends only on the live inputs, so re-running is harmless; one failing zone never stops
   * the others.
   *
   * @return what this run did
   */
  CycleResult recompute();

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

  /**
   * One cycle run's outcome.
   *
   * @param processed zones this run computed
   * @param skipped zones locked by another run or already computed in this cycle
   * @param failed zones whose computation threw (logged; the next cycle retries them)
   */
  record CycleResult(int processed, int skipped, int failed) {}
}
