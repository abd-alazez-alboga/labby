package com.labby.backend.service;

import com.labby.backend.enums.RideParty;
import java.util.UUID;

/**
 * USR-04..06 suspension machinery (trust-v1.yaml "Suspension"): automatic low-rating role
 * suspension (USR-05), manual role suspend/reactivate and whole-account suspend/reactivate (USR-06
 * "deactivate"). Every admin change is audit-logged with the note; every change notifies the user
 * (category {@code account}). A suspended driver role or account goes offline at once unless on a
 * ride (then when it ends).
 */
public interface SuspensionService {

  /**
   * USR-05: suspends an ACTIVE role with reason {@code low_rating} and notifies the rule that
   * fired. A role already suspended (any reason) is left untouched.
   *
   * @param userId the rated user
   * @param role the rated role
   * @param rule the region's rule that fired
   * @return true when suspended now
   */
  boolean suspendForLowRating(UUID userId, RideParty role, TrustRules.RatingRule rule);

  /**
   * Manual role suspension with a mandatory note; replaces an automatic reason.
   *
   * @param actorUserId the admin
   * @param userId the user
   * @param role the role
   * @param note the reason shown to the user
   * @throws com.labby.backend.exception.ResourceNotFoundException unknown user / role not held
   * @throws com.labby.backend.exception.ConflictException {@code admin_account}, {@code
   *     already_suspended}
   */
  void suspendRole(UUID actorUserId, UUID userId, RideParty role, String note);

  /**
   * Lifts a {@code low_rating} or {@code manual} role suspension.
   *
   * @param actorUserId the admin
   * @param userId the user
   * @param role the role
   * @param note the reason shown to the user
   * @throws com.labby.backend.exception.ResourceNotFoundException unknown user / role not held
   * @throws com.labby.backend.exception.ConflictException {@code not_suspended}, {@code
   *     document_expired}
   */
  void reactivateRole(UUID actorUserId, UUID userId, RideParty role, String note);

  /**
   * USR-06 "deactivate": suspends the whole account (reason {@code manual}).
   *
   * @param actorUserId the admin
   * @param userId the user
   * @param note the reason shown to the user
   * @throws com.labby.backend.exception.ResourceNotFoundException unknown user
   * @throws com.labby.backend.exception.ConflictException {@code admin_account}, {@code
   *     account_deleted}, {@code already_suspended}
   */
  void suspendAccount(UUID actorUserId, UUID userId, String note);

  /**
   * Lifts a whole-account suspension; role-level suspensions stay as they are.
   *
   * @param actorUserId the admin
   * @param userId the user
   * @param note the reason shown to the user
   * @throws com.labby.backend.exception.ResourceNotFoundException unknown user
   * @throws com.labby.backend.exception.ConflictException {@code not_suspended}
   */
  void reactivateAccount(UUID actorUserId, UUID userId, String note);

  /**
   * Whether the whole account is suspended — every rider/driver feature then answers 403 {@code
   * account_suspended}.
   *
   * @param userId the account
   * @return true when suspended
   */
  boolean isAccountSuspended(UUID userId);

  /**
   * Whether the user has a ride in flight (accepted / driver_arrived / in_progress) — the
   * suspended-account exemption "finish the ride" (owner ruling 2026-10-15).
   *
   * @param userId the account
   * @param side the side, or null for either
   * @return true when such a ride exists
   */
  boolean hasActiveRide(UUID userId, RideParty side);

  /**
   * Whether the ride is in flight and the user is its party on the given side.
   *
   * @param userId the account
   * @param rideId the ride
   * @param side the side, or null for either
   * @return true when the user may act on it to finish it
   */
  boolean isActiveRideParty(UUID userId, UUID rideId, RideParty side);

  /**
   * Whether the ride is the driver's, completed, with the cash payment still {@code pending} — the
   * post-completion payment step of finishing a ride.
   *
   * @param driverUserId the driver
   * @param rideId the ride
   * @return true when cash-confirm / mark-unpaid is still due
   */
  boolean isAwaitingPayment(UUID driverUserId, UUID rideId);
}
