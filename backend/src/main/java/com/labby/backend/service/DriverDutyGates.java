package com.labby.backend.service;

import java.util.UUID;

/**
 * Availability rules beyond the M5 gates (UC-D-04): the COM-03 balance floor (M8) and the
 * active-ride offline block (M7).
 */
public interface DriverDutyGates {

  /**
   * Why an online driver gets no offers, evaluated against their operating region (UC-D-04 E2,
   * COM-03).
   *
   * @param driverUserId the driver
   * @return the reason ({@code balance_below_floor}), or null when offers flow
   */
  String offersBlockedReason(UUID driverUserId);

  /**
   * Why a driver may not be offered a ride in this region: the driver's balance in the region's
   * currency is at/below the region's floor (COM-03 — dispatch checks the RIDE region).
   *
   * @param driverUserId the driver
   * @param regionId the ride's region
   * @return the reason ({@code balance_below_floor}), or null when offers flow
   */
  String offersBlockedReason(UUID driverUserId, UUID regionId);

  /**
   * Whether the driver is on an active ride, which forbids going offline (M7).
   *
   * @param driverUserId the driver
   * @return true when going offline must be refused
   */
  boolean hasActiveRide(UUID driverUserId);
}
