package com.labby.backend.service;

import com.labby.backend.dto.LocationSampleDto;
import java.util.List;
import java.util.UUID;

/**
 * Ride-side tracking (TRK-02/03/04): traces and relays an assigned driver's samples, and the
 * monitor that notices a driver's stream going stale / resuming and refreshes the rider's ETA.
 */
public interface RideTrackingService {

  /**
   * Appends accepted samples to the driver's assigned ride trace ({@code to_pickup} before start,
   * {@code in_ride} after) and relays the newest to the rider. No assigned ride → nothing.
   *
   * @param driverUserId the driver
   * @param samples samples already accepted by ingestion (device time clamped)
   */
  void record(UUID driverUserId, List<LocationSampleDto> samples);

  /**
   * One monitor pass over the assigned rides: stream-lost / resumed edges ({@code ride.connection})
   * and ETA refresh.
   *
   * @return how many rides changed
   */
  int monitor();
}
