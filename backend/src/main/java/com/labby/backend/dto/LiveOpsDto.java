package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One polled live ops snapshot per region (comms-v1.yaml {@code LiveOps}, ADM-03, UC-A-19).
 *
 * @param regionId the region
 * @param serverTime when the snapshot was taken
 * @param refreshSeconds the poll pace (LIVEOPS_REFRESH_SECONDS)
 * @param drivers online drivers with a fresh position in the region
 * @param rides active rides (requested → in_progress)
 * @param surgeZones the M9 surge overlay
 * @param sosEvents OPEN events only — the red pins (caller phone for {@code support:handle} only)
 */
public record LiveOpsDto(
    UUID regionId,
    Instant serverTime,
    int refreshSeconds,
    List<LiveOpsDriverDto> drivers,
    List<LiveOpsRideDto> rides,
    List<LiveOpsSurgeZoneDto> surgeZones,
    List<AdminSosEventDto> sosEvents) {

  /**
   * The same snapshot with the SOS callers' phones withheld — the feed is {@code rides:view}, but
   * contact access needs {@code support:handle} (UC-A-20).
   *
   * @return the snapshot without SOS phones
   */
  public LiveOpsDto withoutSosPhones() {
    return new LiveOpsDto(
        regionId,
        serverTime,
        refreshSeconds,
        drivers,
        rides,
        surgeZones,
        sosEvents.stream().map(AdminSosEventDto::withoutPhone).toList());
  }

  /**
   * One driver dot (idle vs on-ride).
   *
   * @param driverUserId the driver
   * @param name the driver's full name
   * @param lat latitude
   * @param lng longitude
   * @param headingDeg heading, or null
   * @param status idle or on_ride
   * @param rideId the assigned ride when on_ride, or null
   */
  public record LiveOpsDriverDto(
      UUID driverUserId,
      String name,
      double lat,
      double lng,
      Double headingDeg,
      String status,
      UUID rideId) {}

  /**
   * One active ride (the route line is pickup → stops → destination).
   *
   * @param rideId the ride
   * @param state the current state
   * @param pickup the pickup point
   * @param destination the destination point
   * @param stops intermediate stops, in order
   * @param driverUserId the bound driver, or null before acceptance
   * @param sosOpen red flag — an unacknowledged SOS exists
   */
  public record LiveOpsRideDto(
      UUID rideId,
      String state,
      LatLngDto pickup,
      LatLngDto destination,
      List<LatLngDto> stops,
      UUID driverUserId,
      boolean sosOpen) {}

  /**
   * One surge-overlay zone (the M9 state's shape).
   *
   * @param id the zone
   * @param name the zone name
   * @param polygon the zone polygon
   * @param multiplier the current multiplier
   * @param level the heatmap level of the multiplier
   */
  public record LiveOpsSurgeZoneDto(
      UUID id, String name, GeoJsonPolygonDto polygon, BigDecimal multiplier, int level) {}
}
