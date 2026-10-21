package com.labby.backend.service;

import com.labby.backend.dto.DriverBalanceViewDto;
import com.labby.backend.dto.EarningsSummaryDto;
import com.labby.backend.dto.TripEarningDto;
import com.labby.backend.dto.TripEarningPageDto;
import java.time.LocalDate;
import java.util.UUID;

/** The driver-facing money views (UC-D-15/16, money-v1.yaml). */
public interface DriverEarningsService {

  /**
   * One newest-first page of per-trip earnings, fully itemized (COM-01).
   *
   * @param driverUserId the driver
   * @param page zero-based page
   * @param size page size
   * @return the page
   */
  TripEarningPageDto earnings(UUID driverUserId, int page, int size);

  /**
   * One trip row (V1 conformance W43, the trip detail): the earnings row of a ride the driver drove
   * or accepted before it was cancelled, with the driver's own report on its rider.
   *
   * @param driverUserId the driver
   * @param rideId the ride
   * @param memberId the shared-ride member the row is about (needed when the ride has several)
   * @return the row
   * @throws com.labby.backend.exception.ResourceNotFoundException no such trip of this driver
   * @throws com.labby.backend.exception.InvalidRequestException {@code member_required}
   */
  TripEarningDto trip(UUID driverUserId, UUID rideId, UUID memberId);

  /**
   * The weekly (Monday-start, operating region time zone) or monthly summary containing {@code
   * anchor}.
   *
   * @param driverUserId the driver
   * @param period {@code weekly} or {@code monthly}
   * @param anchor the anchor date (today when null)
   * @return the summary
   */
  EarningsSummaryDto summary(UUID driverUserId, String period, LocalDate anchor);

  /**
   * Per-currency balances with floor standing, plus the commission tier status (COM-02/03).
   *
   * @param driverUserId the driver
   * @return the view
   */
  DriverBalanceViewDto balance(UUID driverUserId);
}
