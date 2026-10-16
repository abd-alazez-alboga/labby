package com.labby.backend.service;

import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.enums.SuspensionReason;
import com.labby.backend.model.DriverProfile;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.DriverDocumentRepository;
import com.labby.backend.repository.DriverProfileRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.VehicleRepository;
import java.time.LocalDate;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Driver-role grant, expiry suspension and reinstatement (see {@link DriverRoleService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverRoleServiceImpl implements DriverRoleService {

  private final RoleAssignmentRepository roleAssignmentRepository;
  private final VehicleRepository vehicleRepository;
  private final DriverDocumentRepository driverDocumentRepository;
  private final NotificationService notificationService;
  private final OperatingCalendar calendar;
  private final DriverProfileRepository driverProfileRepository;
  private final DriverDutyGates driverDutyGates;

  @Override
  public void grantDriverRole(UUID userId) {
    Optional<RoleAssignment> existing = driverRole(userId);
    if (existing.isEmpty()) {
      roleAssignmentRepository.save(
          RoleAssignment.builder()
              .userId(userId)
              .role(Role.DRIVER)
              .state(RoleState.ACTIVE)
              .build());
      return;
    }
    reinstateIfNoExpiredDocument(userId);
  }

  @Override
  public boolean suspendForExpiredDocument(UUID userId) {
    // Lock, then re-check under the lock: a renewal or switch approved since the job read its
    // candidates must win, or the driver would stay suspended with nothing expired.
    Optional<RoleAssignment> role = lockedDriverRole(userId);
    if (role.isEmpty()
        || role.get().getState() != RoleState.ACTIVE
        || !hasExpiredCurrentDocument(userId)) {
      return false;
    }
    role.get().setState(RoleState.SUSPENDED);
    role.get().setSuspensionReason(SuspensionReason.DOCUMENT_EXPIRED);
    role.get().setSuspendedAt(calendar.now());
    roleAssignmentRepository.save(role.get());
    forceOfflineUnlessOnRide(userId);
    notificationService.queue(
        userId,
        NotificationEvent.DRIVER_SUSPENDED,
        Map.of("reason", SuspensionReason.DOCUMENT_EXPIRED.getValue()));
    return true;
  }

  /**
   * Suspension forces the driver offline (M6 owner item a, M7); a driver on an assigned ride
   * finishes it first and goes offline when it ends ({@link RideLifecycle#releaseDriver}).
   */
  private void forceOfflineUnlessOnRide(UUID userId) {
    if (driverDutyGates.hasActiveRide(userId)) {
      return;
    }
    driverProfileRepository
        .findByUserId(userId)
        .filter(DriverProfile::isOnline)
        .ifPresent(
            profile -> {
              profile.setOnline(false);
              profile.setOnlineChangedAt(calendar.now());
              driverProfileRepository.save(profile);
            });
  }

  @Override
  public boolean reinstateIfNoExpiredDocument(UUID userId) {
    Optional<RoleAssignment> role = lockedDriverRole(userId);
    if (role.isEmpty()
        || role.get().getState() != RoleState.SUSPENDED
        || role.get().getSuspensionReason() != SuspensionReason.DOCUMENT_EXPIRED
        || hasExpiredCurrentDocument(userId)) {
      return false;
    }
    role.get().setState(RoleState.ACTIVE);
    role.get().setSuspensionReason(null);
    role.get().setSuspendedAt(null);
    // Re-audit W-1: a lifted suspension is a reactivation for USR-05 too — the nightly pass
    // re-suspends for low rating only on a rating stored after this moment.
    role.get().setReactivatedAt(calendar.now());
    roleAssignmentRepository.save(role.get());
    notificationService.queue(userId, NotificationEvent.DRIVER_REINSTATED);
    return true;
  }

  @Override
  @Transactional(readOnly = true)
  public boolean isSuspendedForExpiry(UUID userId) {
    return driverRole(userId)
        .filter(role -> role.getState() == RoleState.SUSPENDED)
        .filter(role -> role.getSuspensionReason() == SuspensionReason.DOCUMENT_EXPIRED)
        .isPresent();
  }

  @Override
  @Transactional(readOnly = true)
  public boolean isSuspended(UUID userId) {
    return driverRole(userId).filter(role -> role.getState() == RoleState.SUSPENDED).isPresent();
  }

  private Optional<RoleAssignment> driverRole(UUID userId) {
    return roleAssignmentRepository.findByUserIdAndRole(userId, Role.DRIVER);
  }

  private Optional<RoleAssignment> lockedDriverRole(UUID userId) {
    return roleAssignmentRepository.findForUpdate(userId, Role.DRIVER);
  }

  /** Current = approved ID/licence + the ACTIVE vehicle's approved registration/insurance. */
  @Override
  @Transactional(readOnly = true)
  public boolean hasExpiredCurrentDocument(UUID userId) {
    LocalDate today = calendar.today();
    UUID activeVehicleId =
        vehicleRepository.findByDriverUserIdAndActiveTrue(userId).map(Vehicle::getId).orElse(null);
    return driverDocumentRepository.findByDriverUserIdOrderByCreatedAtAsc(userId).stream()
        .filter(document -> document.getReviewStatus() == ReviewStatus.APPROVED)
        .filter(
            document ->
                document.getVehicleId() == null
                    || Objects.equals(document.getVehicleId(), activeVehicleId))
        .anyMatch(document -> document.getExpiresOn().isBefore(today));
  }
}
