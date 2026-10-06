package com.labby.backend.service;

import java.util.UUID;

/**
 * Seams for the availability rules later milestones own (UC-D-04): the balance floor (M8, COM-03)
 * and the active-ride offline block (M7). Their V1 implementation allows everything.
 */
public interface DriverDutyGates {

  /**
   * Why an online driver gets no offers (M8 balance floor, UC-D-04 E2).
   *
   * @param driverUserId the driver
   * @return the reason, or null when offers flow
   */
  String offersBlockedReason(UUID driverUserId);

  /**
   * Whether the driver is on an active ride, which forbids going offline (M7).
   *
   * @param driverUserId the driver
   * @return true when going offline must be refused
   */
  boolean hasActiveRide(UUID driverUserId);
}
