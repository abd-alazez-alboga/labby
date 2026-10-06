package com.labby.backend.service;

import com.labby.backend.dto.DriverAvailabilityDto;
import java.util.UUID;

/**
 * Driver online/offline (DRV-05, UC-D-04). Going online requires the driver role ACTIVE, an
 * approved application and an active approved vehicle.
 */
public interface DriverAvailabilityService {

  /**
   * The driver's state and whether they may go online.
   *
   * @param userId the caller
   * @return the availability
   * @throws com.labby.backend.exception.ConflictException when the account has no driver profile
   */
  DriverAvailabilityDto get(UUID userId);

  /**
   * Goes online or offline (idempotent).
   *
   * @param userId the caller
   * @param online the requested state
   * @return the new availability
   * @throws com.labby.backend.exception.ConflictException when there is no driver profile, a gate
   *     refuses going online, or (from M7) going offline during an active ride
   */
  DriverAvailabilityDto set(UUID userId, boolean online);
}
