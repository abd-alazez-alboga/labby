package com.labby.backend.dto;

import com.labby.backend.enums.RideParty;
import java.time.Instant;
import java.util.UUID;

/**
 * One SOS event of the admin alert list (comms-v1.yaml {@code AdminSosEvent}, UC-A-20).
 *
 * @param sosEventId the event id
 * @param rideId the ride
 * @param triggeredByRole rider or driver
 * @param lat latitude at the tap
 * @param lng longitude
 * @param triggeredAt device moment, clamped to server time
 * @param createdAt when the server recorded it
 * @param regionId the ride's region
 * @param triggeredBy who triggered it (contact access is gated by the list's permission)
 * @param rideState the ride's current state
 * @param acknowledged the stand-down stamp, or null while the alert is open
 */
public record AdminSosEventDto(
    UUID sosEventId,
    UUID rideId,
    RideParty triggeredByRole,
    double lat,
    double lng,
    Instant triggeredAt,
    Instant createdAt,
    UUID regionId,
    TriggeredByDto triggeredBy,
    String rideState,
    AcknowledgedDto acknowledged) {

  /**
   * The triggering account (UC-A-20 contact access).
   *
   * @param userId the account
   * @param name the full name
   * @param phone the phone number
   */
  public record TriggeredByDto(UUID userId, String name, String phone) {}

  /**
   * The acknowledgement stamp (SAFE-01 stand-down).
   *
   * @param byUserId the acknowledging admin
   * @param byName the admin's name
   * @param at when
   * @param note the optional note (the M14 linked-ticket stub)
   */
  public record AcknowledgedDto(UUID byUserId, String byName, Instant at, String note) {}
}
