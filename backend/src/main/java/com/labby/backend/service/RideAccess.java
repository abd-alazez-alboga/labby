package com.labby.backend.service;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.repository.DriverProfileRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Role gates of the ride endpoints (rides-v1.yaml): rider endpoints need the rider role, booking
 * needs it ACTIVE (UC-R-04 E3); driver endpoints need an approved driver — a driver suspended
 * mid-ride may still finish and settle that ride, dispatch never offers them a new one.
 */
@Component
@RequiredArgsConstructor
public class RideAccess {

  private final RoleAssignmentRepository roleAssignmentRepository;
  private final DriverProfileRepository driverProfileRepository;

  /**
   * Requires the rider role (any state).
   *
   * @param userId the account
   */
  public void requireRider(UUID userId) {
    if (!roleAssignmentRepository.existsByUserIdAndRole(userId, Role.RIDER)) {
      throw new ForbiddenException("This account is not a rider");
    }
  }

  /**
   * Requires an ACTIVE rider role (booking, UC-R-04 E3): a suspended role is a 403 carrying its
   * {@code suspensionReason}.
   *
   * @param userId the account
   */
  public void requireActiveRider(UUID userId) {
    RoleAssignment role =
        roleAssignmentRepository
            .findByUserIdAndRole(userId, Role.RIDER)
            .orElseThrow(() -> new ForbiddenException("This account is not a rider"));
    if (role.getState() == RoleState.SUSPENDED) {
      throw new ForbiddenException("Your rider account is suspended")
          .withCode("rider_suspended")
          .withDetail(
              "suspensionReason",
              role.getSuspensionReason() == null ? null : role.getSuspensionReason().getValue());
    }
  }

  /**
   * Requires an approved driver.
   *
   * @param userId the account
   */
  public void requireDriver(UUID userId) {
    boolean approved =
        driverProfileRepository
            .findByUserId(userId)
            .map(profile -> profile.getApplicationStatus() == ApplicationStatus.APPROVED)
            .orElse(false);
    if (!approved || !roleAssignmentRepository.existsByUserIdAndRole(userId, Role.DRIVER)) {
      throw new ForbiddenException("This account is not an approved driver");
    }
  }
}
