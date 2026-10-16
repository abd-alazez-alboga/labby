package com.labby.backend.service;

import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.enums.SuspensionReason;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.DriverProfile;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.User;
import com.labby.backend.repository.DriverProfileRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.UserRepository;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Suspension machinery (see {@link SuspensionService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class SuspensionServiceImpl implements SuspensionService {

  private static final String TARGET_TYPE_USER = "user";

  /** A request not yet accepted by a driver. */
  private static final List<RideState> PRE_ACCEPTANCE =
      List.of(RideState.REQUESTED, RideState.OFFERING);

  private final UserRepository userRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final RideRepository rideRepository;
  private final RideLifecycle rideLifecycle;
  private final RideEvents rideEvents;
  private final DriverRoleService driverRoleService;
  private final DriverProfileRepository driverProfileRepository;
  private final DriverDutyGates driverDutyGates;
  private final NotificationService notificationService;
  private final AuditService auditService;
  private final OperatingCalendar calendar;
  private final ScheduledRideService scheduledRideService;
  private final SharedRideService sharedRideService;

  @Override
  public boolean suspendForLowRating(UUID userId, RideParty role, TrustRules.RatingRule rule) {
    RoleAssignment assignment =
        roleAssignmentRepository.findForUpdate(userId, toRole(role)).orElse(null);
    if (assignment == null || assignment.getState() != RoleState.ACTIVE) {
      return false;
    }
    suspend(assignment, SuspensionReason.LOW_RATING, null);
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("role", role.getValue());
    params.put("reason", SuspensionReason.LOW_RATING.getValue());
    params.put("minAvgRating", rule.minAvgRating().stripTrailingZeros().toPlainString());
    params.put("minRatedRides", rule.minRatedRides());
    notificationService.queue(userId, NotificationEvent.ROLE_SUSPENDED, params);
    return true;
  }

  @Override
  public void suspendRole(UUID actorUserId, UUID userId, RideParty role, String note) {
    requireUser(userId);
    requireNotAdmin(userId);
    RoleAssignment assignment = requireRole(userId, role);
    if (assignment.getState() == RoleState.SUSPENDED
        && assignment.getSuspensionReason() == SuspensionReason.MANUAL) {
      throw conflict("This role is already suspended", "already_suspended");
    }
    Map<String, Object> before = roleSnapshot(assignment);
    suspend(assignment, SuspensionReason.MANUAL, note);
    auditService.record(
        actorUserId,
        "user.role_suspend",
        TARGET_TYPE_USER,
        userId.toString(),
        before,
        roleSnapshot(assignment));
    notificationService.queue(
        userId,
        NotificationEvent.ROLE_SUSPENDED,
        Map.of(
            "role", role.getValue(), "reason", SuspensionReason.MANUAL.getValue(), "note", note));
  }

  @Override
  public void reactivateRole(UUID actorUserId, UUID userId, RideParty role, String note) {
    requireUser(userId);
    RoleAssignment assignment = requireRole(userId, role);
    if (assignment.getState() != RoleState.SUSPENDED) {
      throw conflict("This role is not suspended", "not_suspended");
    }
    if (assignment.getSuspensionReason() == SuspensionReason.DOCUMENT_EXPIRED) {
      throw conflict(
          "A document-expiry suspension is lifted only by an approved renewal", "document_expired");
    }
    Map<String, Object> before = roleSnapshot(assignment);
    if (role == RideParty.DRIVER && driverRoleService.hasExpiredCurrentDocument(userId)) {
      // Review B-W4 (owner ruling 2026-10-16): DRV-04 wins — the role stays suspended, now for the
      // expired document, lifted only by an approved renewal. Audited as the attempt it was.
      assignment.setSuspensionReason(SuspensionReason.DOCUMENT_EXPIRED);
      assignment.setSuspensionNote(null);
      // Re-audit W-1: the admin's decision on the low-rating / manual reason counts as a
      // reactivation for USR-05 — only a rating stored after it may re-suspend for low rating.
      assignment.setReactivatedAt(calendar.now());
      roleAssignmentRepository.save(assignment);
      Map<String, Object> after = roleSnapshot(assignment);
      after.put("note", note);
      after.put("result", SuspensionReason.DOCUMENT_EXPIRED.getValue());
      auditService.record(
          actorUserId, "user.role_reactivate", TARGET_TYPE_USER, userId.toString(), before, after);
      notificationService.queue(
          userId,
          NotificationEvent.DRIVER_SUSPENDED,
          Map.of("reason", SuspensionReason.DOCUMENT_EXPIRED.getValue()));
      return;
    }
    assignment.setState(RoleState.ACTIVE);
    assignment.setSuspensionReason(null);
    assignment.setSuspensionNote(null);
    assignment.setSuspendedAt(null);
    assignment.setReactivatedAt(calendar.now());
    roleAssignmentRepository.save(assignment);
    Map<String, Object> after = roleSnapshot(assignment);
    after.put("note", note);
    auditService.record(
        actorUserId, "user.role_reactivate", TARGET_TYPE_USER, userId.toString(), before, after);
    notificationService.queue(
        userId, NotificationEvent.ROLE_REACTIVATED, Map.of("role", role.getValue(), "note", note));
  }

  @Override
  public void suspendAccount(UUID actorUserId, UUID userId, String note) {
    User user = requireUser(userId);
    requireNotAdmin(userId);
    if (user.getState() == AccountState.DELETED) {
      throw conflict("A deleted account cannot be suspended", "account_deleted");
    }
    if (user.getState() == AccountState.SUSPENDED) {
      throw conflict("This account is already suspended", "already_suspended");
    }
    Map<String, Object> before = accountSnapshot(user);
    user.setState(AccountState.SUSPENDED);
    user.setSuspensionReason(SuspensionReason.MANUAL);
    user.setSuspensionNote(note);
    user.setSuspendedAt(calendar.now());
    userRepository.save(user);
    forceOfflineUnlessOnRide(userId, calendar.now());
    cancelPendingRequests(userId, calendar.now());
    // M12 (approved reading 2026-10-16): scheduled rides as rider are cancelled, claims as driver
    // released — both by the system, free, no metric event.
    scheduledRideService.onAccountSuspended(userId, calendar.now());
    sharedRideService.onAccountSuspended(userId, calendar.now());
    auditService.record(
        actorUserId,
        "user.suspend",
        TARGET_TYPE_USER,
        userId.toString(),
        before,
        accountSnapshot(user));
    notificationService.queue(userId, NotificationEvent.ACCOUNT_SUSPENDED, Map.of("note", note));
  }

  @Override
  public void reactivateAccount(UUID actorUserId, UUID userId, String note) {
    User user = requireUser(userId);
    if (user.getState() != AccountState.SUSPENDED) {
      throw conflict("This account is not suspended", "not_suspended");
    }
    Map<String, Object> before = accountSnapshot(user);
    user.setState(AccountState.ACTIVE);
    user.setSuspensionReason(null);
    user.setSuspensionNote(null);
    user.setSuspendedAt(null);
    userRepository.save(user);
    Map<String, Object> after = accountSnapshot(user);
    after.put("note", note);
    auditService.record(
        actorUserId, "user.reactivate", TARGET_TYPE_USER, userId.toString(), before, after);
    notificationService.queue(userId, NotificationEvent.ACCOUNT_REACTIVATED, Map.of("note", note));
  }

  @Override
  @Transactional(readOnly = true)
  public boolean isAccountSuspended(UUID userId) {
    return userRepository
        .findById(userId)
        .map(user -> user.getState() == AccountState.SUSPENDED)
        .orElse(false);
  }

  @Override
  @Transactional(readOnly = true)
  public boolean hasActiveRide(UUID userId, RideParty side) {
    boolean asRider =
        side != RideParty.DRIVER
            && rideRepository
                .findFirstByRiderUserIdAndStateIn(userId, RideRepository.ASSIGNED_STATES)
                .isPresent();
    return asRider
        || (side != RideParty.RIDER
            && rideRepository.existsByDriverUserIdAndStateIn(
                userId, RideRepository.ASSIGNED_STATES));
  }

  @Override
  @Transactional(readOnly = true)
  public boolean isActiveRideParty(UUID userId, UUID rideId, RideParty side) {
    return rideRepository
        .findById(rideId)
        .filter(Ride::isAssigned)
        .filter(
            ride ->
                (side != RideParty.DRIVER && userId.equals(ride.getRiderUserId()))
                    || (side != RideParty.RIDER && userId.equals(ride.getDriverUserId())))
        .isPresent();
  }

  @Override
  @Transactional(readOnly = true)
  public boolean isAwaitingPayment(UUID driverUserId, UUID rideId) {
    return rideRepository
        .findById(rideId)
        .filter(ride -> ride.getState() == RideState.COMPLETED)
        .filter(ride -> ride.getPaymentStatus() == PaymentStatus.PENDING)
        .filter(ride -> driverUserId.equals(ride.getDriverUserId()))
        .isPresent();
  }

  /**
   * Review B-W5 (owner ruling 2026-10-16): the account's pre-acceptance request (requested /
   * offering, as rider) is system-cancelled — {@code cancelled_by_rider} with reason {@code
   * account_suspended}, no fee, its open offer withdrawn — so it is never dispatched to a driver
   * the rider can no longer cancel for. Accepted rides go on (the finish-the-ride exemption).
   */
  private void cancelPendingRequests(UUID userId, Instant now) {
    rideRepository
        .findFirstByRiderUserIdAndStateIn(userId, PRE_ACCEPTANCE)
        .flatMap(ride -> rideRepository.findForUpdate(ride.getId()))
        .filter(ride -> PRE_ACCEPTANCE.contains(ride.getState()))
        .ifPresent(
            ride -> {
              rideLifecycle.withdrawOpenOffer(ride, now);
              ride.setState(RideState.CANCELLED_BY_RIDER);
              ride.setCancelledAt(now);
              ride.setCancellationReason(CancellationReason.ACCOUNT_SUSPENDED);
              ride.setCancellationFee(null);
              rideEvents.stateChanged(rideRepository.saveAndFlush(ride));
            });
  }

  private void suspend(RoleAssignment assignment, SuspensionReason reason, String note) {
    Instant now = calendar.now();
    assignment.setState(RoleState.SUSPENDED);
    assignment.setSuspensionReason(reason);
    assignment.setSuspensionNote(note);
    assignment.setSuspendedAt(now);
    roleAssignmentRepository.save(assignment);
    if (assignment.getRole() == Role.DRIVER) {
      forceOfflineUnlessOnRide(assignment.getUserId(), now);
      scheduledRideService.releaseClaimsOfSuspendedDriver(assignment.getUserId(), now);
    }
  }

  /**
   * Suspension forces the driver offline (M6 owner item a); a driver on an assigned ride finishes
   * it first and goes offline when it ends ({@link RideLifecycle#releaseDriver}).
   */
  private void forceOfflineUnlessOnRide(UUID userId, Instant now) {
    if (driverDutyGates.hasActiveRide(userId)) {
      return;
    }
    driverProfileRepository
        .findByUserId(userId)
        .filter(DriverProfile::isOnline)
        .ifPresent(
            profile -> {
              profile.setOnline(false);
              profile.setOnlineChangedAt(now);
              driverProfileRepository.save(profile);
            });
  }

  private User requireUser(UUID userId) {
    return userRepository
        .findById(userId)
        .orElseThrow(() -> new ResourceNotFoundException("User", userId));
  }

  /** Admin accounts are handled by RBAC's deactivate, never here (trust-v1.yaml). */
  private void requireNotAdmin(UUID userId) {
    if (roleAssignmentRepository.existsByUserIdAndRole(userId, Role.ADMIN)) {
      throw conflict("Admin accounts are managed from admin management", "admin_account");
    }
  }

  private RoleAssignment requireRole(UUID userId, RideParty role) {
    return roleAssignmentRepository
        .findForUpdate(userId, toRole(role))
        .orElseThrow(
            () ->
                new ResourceNotFoundException(
                    "The user does not hold the " + role.getValue() + " role"));
  }

  private static Role toRole(RideParty role) {
    return role == RideParty.DRIVER ? Role.DRIVER : Role.RIDER;
  }

  private static ConflictException conflict(String message, String code) {
    return (ConflictException) new ConflictException(message).withCode(code);
  }

  private static Map<String, Object> roleSnapshot(RoleAssignment assignment) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("role", assignment.getRole().getValue());
    snapshot.put("state", assignment.getState().getValue());
    snapshot.put(
        "suspensionReason",
        assignment.getSuspensionReason() == null
            ? null
            : assignment.getSuspensionReason().getValue());
    snapshot.put("suspensionNote", assignment.getSuspensionNote());
    return snapshot;
  }

  private static Map<String, Object> accountSnapshot(User user) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("state", user.getState().getValue());
    snapshot.put("suspensionNote", user.getSuspensionNote());
    return snapshot;
  }
}
