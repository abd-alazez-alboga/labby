package com.labby.backend.service;

import com.labby.backend.config.TrackingProperties;
import com.labby.backend.dto.DriverAvailabilityDto;
import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.CannotGoOnlineReason;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.enums.SuspensionReason;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.model.DriverProfile;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.repository.DriverProfileRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.VehicleRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Online state lives on {@code driver_profiles.is_online} (V7 CHECK: only approved drivers). The
 * gates are evaluated in the contract's order: role suspended → not approved → no active vehicle.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverAvailabilityServiceImpl implements DriverAvailabilityService {

  private final DriverProfileRepository driverProfileRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final VehicleRepository vehicleRepository;
  private final DriverLocationService driverLocationService;
  private final DriverDutyGates driverDutyGates;
  private final TrackingProperties trackingProperties;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public DriverAvailabilityDto get(UUID userId) {
    return toDto(requireProfile(userId));
  }

  @Override
  public DriverAvailabilityDto set(UUID userId, boolean online) {
    DriverProfile profile = requireProfile(userId);
    if (online) {
      Gate gate = gate(profile);
      if (gate.reason() != null) {
        throw new ConflictException(message(gate.reason()));
      }
    } else if (profile.isOnline() && driverDutyGates.hasActiveRide(userId)) {
      throw new ConflictException("You can't go offline during an active ride");
    }
    if (profile.isOnline() != online) {
      profile.setOnline(online);
      profile.setOnlineChangedAt(clock.instant());
      profile = driverProfileRepository.saveAndFlush(profile);
    }
    return toDto(profile);
  }

  private DriverProfile requireProfile(UUID userId) {
    return driverProfileRepository
        .findByUserId(userId)
        .orElseThrow(() -> new ConflictException("This account has no driver profile"));
  }

  private DriverAvailabilityDto toDto(DriverProfile profile) {
    Gate gate = gate(profile);
    boolean online = profile.isOnline();
    Instant onlineSince = online ? profile.getOnlineChangedAt() : null;
    return new DriverAvailabilityDto(
        online,
        onlineSince,
        gate.reason() == null,
        gate.reason(),
        gate.suspensionReason(),
        online ? driverDutyGates.offersBlockedReason(profile.getUserId()) : null,
        online ? driverLocationService.isStreamHealthy(profile.getUserId()) : null,
        trackingProperties.streamIntervalSeconds(),
        trackingProperties.staleAfterSeconds());
  }

  /** The first failing gate, with the role's suspension reason when that is it. */
  private Gate gate(DriverProfile profile) {
    Optional<RoleAssignment> role =
        roleAssignmentRepository.findByUserIdAndRole(profile.getUserId(), Role.DRIVER);
    if (role.isPresent() && role.get().getState() == RoleState.SUSPENDED) {
      return new Gate(CannotGoOnlineReason.ROLE_SUSPENDED, role.get().getSuspensionReason());
    }
    if (role.isEmpty() || profile.getApplicationStatus() != ApplicationStatus.APPROVED) {
      return new Gate(CannotGoOnlineReason.NOT_APPROVED, null);
    }
    if (vehicleRepository.findByDriverUserIdAndActiveTrue(profile.getUserId()).isEmpty()) {
      return new Gate(CannotGoOnlineReason.NO_ACTIVE_VEHICLE, null);
    }
    return new Gate(null, null);
  }

  private static String message(CannotGoOnlineReason reason) {
    return switch (reason) {
      case ROLE_SUSPENDED -> "Your driver account is suspended";
      case NOT_APPROVED -> "Your driver application is not approved";
      case NO_ACTIVE_VEHICLE -> "You have no active approved vehicle";
    };
  }

  private record Gate(CannotGoOnlineReason reason, SuspensionReason suspensionReason) {}
}
