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
 * @param triggeredBy who triggered it; the phone is contact access — {@code support:handle} only
 * @param rideState the ride's current state
 * @param acknowledged the stand-down stamp, or null while the alert is open
 * @param ticketId the linked support ticket (support-v1, M14); null until an admin opens one
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
    AcknowledgedDto acknowledged,
    UUID ticketId) {

  /**
   * The same event with the caller's phone withheld — contact access (UC-A-20, owner rulings
   * 2026-10-14/15) is served only to {@code support:handle} holders.
   *
   * @return the event without {@code triggeredBy.phone}
   */
  public AdminSosEventDto withoutPhone() {
    return new AdminSosEventDto(
        sosEventId,
        rideId,
        triggeredByRole,
        lat,
        lng,
        triggeredAt,
        createdAt,
        regionId,
        new TriggeredByDto(triggeredBy.userId(), triggeredBy.name(), null),
        rideState,
        acknowledged,
        ticketId);
  }

  /**
   * The triggering account (UC-A-20 contact access).
   *
   * @param userId the account
   * @param name the full name
   * @param phone the phone number; null without {@code support:handle}
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
