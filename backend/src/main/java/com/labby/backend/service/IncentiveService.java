package com.labby.backend.service;

import com.labby.backend.dto.IncentiveProgressDto;
import java.time.Instant;
import java.util.UUID;

/** The DRV-08 incentives engine (incentives-v1.yaml; UC-D-17, UC-A-29). */
public interface IncentiveService {

  /**
   * Pays the previous Monday–Sunday week (each region's own zone) of every region with incentive
   * values: weekly trip bonus, peak-hour bonus and rating reward per driver, each exactly once.
   *
   * @param now the evaluation moment (the job's clock)
   * @return how many awards this run paid (0 on a re-run)
   */
  int evaluatePreviousWeek(Instant now);

  /**
   * A driver's live progress this week in a region, plus recent awards.
   *
   * @param driverUserId the approved driver
   * @param regionId the region the app is in
   * @return the progress
   */
  IncentiveProgressDto progress(UUID driverUserId, UUID regionId);
}
