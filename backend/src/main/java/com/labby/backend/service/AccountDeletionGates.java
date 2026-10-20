package com.labby.backend.service;

import com.labby.backend.enums.FloorStatus;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.repository.RideOfferRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * UC-S-07 preconditions and side effects of an account deletion (review V1 H1 / W13 / W9). The
 * gates run BEFORE the 2FA code is consumed, so a blocked user keeps their code:
 *
 * <ul>
 *   <li>E1 {@code active_ride} — the account is on a live ride: as rider its own ride from {@code
 *       requested} to {@code in_progress} (the rides-v1 "active ride", pre-acceptance included) or
 *       a live shared membership; as driver an assigned ride, a completed one whose cash is still
 *       pending, or an open offer;
 *   <li>E2 {@code debt_below_floor} — a driver balance at or below its region floor (COM-03): the
 *       debt is settled first;
 *   <li>{@code last_super_admin} — the last active Super Admin cannot delete itself (W9).
 * </ul>
 *
 * Upcoming scheduled rides and gathering shared memberships are not an "active ride"
 * (scheduled-shared-v1): the deletion ends them like an account suspension does (W13).
 */
@Component
@RequiredArgsConstructor
public class AccountDeletionGates {

  private final RideRepository rideRepository;
  private final SharedRideMemberRepository sharedRideMemberRepository;
  private final RideOfferRepository rideOfferRepository;
  private final MoneyFloors moneyFloors;
  private final SuperAdminGuard superAdminGuard;
  private final SuspensionService suspensionService;

  /**
   * Refuses the deletion while a precondition fails (409 with the code). Takes the rider lock, so
   * no booking, scheduling or shared-ride step of the account slips in until the deletion commits.
   *
   * @param userId the account
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void requireDeletable(UUID userId) {
    rideRepository.lockRider(userId);
    if (onActiveRide(userId)) {
      throw conflict("Finish the active ride before deleting the account", "active_ride");
    }
    boolean belowFloor =
        moneyFloors.balanceEntries(userId).stream()
            .anyMatch(entry -> entry.status() == FloorStatus.BLOCKED);
    if (belowFloor) {
      throw conflict(
          "Settle the driver balance before deleting the account (COM-03)", "debt_below_floor");
    }
    superAdminGuard.requireNotLast(userId, "The last active Super Admin cannot delete the account");
  }

  /**
   * The deletion's side effects, as on an account suspension: the driver goes offline, a
   * pre-acceptance request is cancelled with its offer withdrawn, scheduled rides are cancelled /
   * claims released and gathering shared memberships end.
   *
   * @param userId the deleted account
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void cleanUp(UUID userId) {
    suspensionService.onAccountDeleted(userId);
  }

  private boolean onActiveRide(UUID userId) {
    return rideRepository.findOwnActive(userId, RideRepository.ACTIVE_STATES).isPresent()
        || sharedRideMemberRepository.findLiveRideOfMember(userId).isPresent()
        || !rideRepository.findDriverCurrent(userId, RideRepository.ASSIGNED_STATES).isEmpty()
        || rideOfferRepository.findFirstByDriverUserIdAndResponseIsNull(userId).isPresent();
  }

  private static ConflictException conflict(String message, String code) {
    return (ConflictException) new ConflictException(message).withCode(code);
  }
}
