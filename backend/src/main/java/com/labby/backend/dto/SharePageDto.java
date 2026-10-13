package com.labby.backend.dto;

import com.labby.backend.enums.RideState;
import java.time.Instant;

/**
 * The public share-page data (comms-v1.yaml {@code SharePage}) — EXACTLY the SHARE-02 list and
 * nothing more: no phone numbers, no rider identity, no fare.
 *
 * @param status accepted, driver_arrived or in_progress (terminal states are the 410)
 * @param driverFirstName the driver's first name
 * @param driverPhotoUrl a fresh expiring photo url, or null
 * @param vehicle model / color / plate
 * @param position the driver's latest position, or null when stale/unknown
 * @param etaSeconds to pickup before start, to destination after; null when unroutable
 * @param refreshSeconds the poll pace (SHARE_REFRESH_SECONDS)
 */
public record SharePageDto(
    RideState status,
    String driverFirstName,
    String driverPhotoUrl,
    ShareVehicleDto vehicle,
    SharePositionDto position,
    Integer etaSeconds,
    int refreshSeconds) {

  /**
   * The shared vehicle facts (SHARE-02).
   *
   * @param model the model
   * @param color the color
   * @param plate the plate
   */
  public record ShareVehicleDto(String model, String color, String plate) {}

  /**
   * The driver's latest position.
   *
   * @param lat latitude
   * @param lng longitude
   * @param headingDeg heading, or null
   * @param recordedAt device fix time
   */
  public record SharePositionDto(double lat, double lng, Double headingDeg, Instant recordedAt) {}
}
