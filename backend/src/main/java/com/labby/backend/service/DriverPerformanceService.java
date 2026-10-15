package com.labby.backend.service;

import com.labby.backend.dto.DriverPerformanceDto;
import com.labby.backend.dto.MetricWarningDto;
import java.util.List;
import java.util.UUID;

/**
 * Driver performance (DRV-06/07, UC-D-20; trust-v1.yaml): metrics computed on read for rolling 7-
 * and 30-day windows, and the DRV-07 warnings — raised and cleared by a periodic evaluation, never
 * a suspension.
 */
public interface DriverPerformanceService {

  /**
   * The dashboard of an approved driver (a suspended driver role may still read it).
   *
   * @param driverUserId the driver
   * @return the dashboard
   * @throws com.labby.backend.exception.ForbiddenException not an approved driver
   */
  DriverPerformanceDto dashboard(UUID driverUserId);

  /**
   * The driver's active warnings with their triggering rule.
   *
   * @param driverUserId the driver
   * @return the warnings, oldest first
   */
  List<MetricWarningDto> activeWarnings(UUID driverUserId);

  /**
   * The drivers the periodic DRV-07 evaluation looks at: any offer or accepted ride in the last 30
   * days, plus every driver holding an active warning (so it can clear).
   *
   * @return the driver ids
   */
  List<UUID> warningCandidates();

  /**
   * DRV-07 for one driver on the region's window (the region of the driver's latest ride; SRS
   * defaults without one): with a sample of at least {@code minSample}, acceptance below the
   * minimum or cancellation above the maximum raises a warning (push + {@code metric_warning}
   * flag); a warning whose condition no longer holds clears.
   *
   * @param driverUserId the driver
   * @return the number of warnings raised now
   */
  int evaluateWarnings(UUID driverUserId);
}
