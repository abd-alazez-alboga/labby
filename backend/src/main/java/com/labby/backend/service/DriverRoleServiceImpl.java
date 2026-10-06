package com.labby.backend.service;

import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.enums.SuspensionReason;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.DriverDocumentRepository;
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
    Optional<RoleAssignment> role = driverRole(userId);
    if (role.isEmpty() || role.get().getState() != RoleState.ACTIVE) {
      return false;
    }
    role.get().setState(RoleState.SUSPENDED);
    role.get().setSuspensionReason(SuspensionReason.DOCUMENT_EXPIRED);
    roleAssignmentRepository.save(role.get());
    notificationService.queue(
        userId,
        NotificationEvent.DRIVER_SUSPENDED,
        Map.of("reason", SuspensionReason.DOCUMENT_EXPIRED.getValue()));
    return true;
  }

  @Override
  public boolean reinstateIfNoExpiredDocument(UUID userId) {
    Optional<RoleAssignment> role = driverRole(userId);
    if (role.isEmpty()
        || role.get().getState() != RoleState.SUSPENDED
        || role.get().getSuspensionReason() != SuspensionReason.DOCUMENT_EXPIRED
        || hasExpiredCurrentDocument(userId)) {
      return false;
    }
    role.get().setState(RoleState.ACTIVE);
    role.get().setSuspensionReason(null);
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

  /** Current = approved ID/licence + the ACTIVE vehicle's approved registration/insurance. */
  private boolean hasExpiredCurrentDocument(UUID userId) {
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
