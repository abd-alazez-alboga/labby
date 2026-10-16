package com.labby.backend.service;

import com.labby.backend.dto.AvailabilityWindowsDto;
import java.util.UUID;

/** The driver's weekly availability windows (DRV-05, UC-D-05; scheduled-shared-v1). */
public interface AvailabilityWindowService {

  /**
   * The driver's current set, by weekday then start.
   *
   * @param driverUserId the driver
   * @return the windows
   */
  AvailabilityWindowsDto get(UUID driverUserId);

  /**
   * Replaces the whole set (an empty list clears it). Existing claims are not affected.
   *
   * @param driverUserId the driver
   * @param request the new set
   * @return the stored set
   */
  AvailabilityWindowsDto replace(UUID driverUserId, AvailabilityWindowsDto request);
}
