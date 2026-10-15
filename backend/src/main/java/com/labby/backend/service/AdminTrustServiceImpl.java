package com.labby.backend.service;

import com.labby.backend.dto.AccountFlagDto;
import com.labby.backend.dto.AdminUserTrustDto;
import com.labby.backend.dto.RoleTrustDto;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.Role;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.User;
import com.labby.backend.repository.RatingRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.UserRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The admin trust profile (see {@link AdminTrustService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class AdminTrustServiceImpl implements AdminTrustService {

  private final UserRepository userRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final RatingRepository ratingRepository;
  private final AccountFlagService accountFlagService;
  private final DriverPerformanceService driverPerformanceService;
  private final ReportService reportService;
  private final SuspensionService suspensionService;

  @Override
  @Transactional(readOnly = true)
  public AdminUserTrustDto trust(UUID userId) {
    User user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new ResourceNotFoundException("User", userId));
    List<AccountFlagDto> openFlags = accountFlagService.openFlags(userId);
    List<RoleTrustDto> roles = new ArrayList<>();
    for (RideParty role : RideParty.values()) {
      roleAssignmentRepository
          .findByUserIdAndRole(userId, role == RideParty.DRIVER ? Role.DRIVER : Role.RIDER)
          .ifPresent(assignment -> roles.add(roleTrust(userId, role, assignment, openFlags)));
    }
    return new AdminUserTrustDto(
        user.getId(),
        user.getName(),
        user.getState(),
        user.getSuspensionNote(),
        user.getSuspendedAt(),
        roles);
  }

  private RoleTrustDto roleTrust(
      UUID userId, RideParty role, RoleAssignment assignment, List<AccountFlagDto> openFlags) {
    RatingRepository.LiveAggregate aggregate =
        ratingRepository.liveAggregate(userId, role.getValue());
    BigDecimal average =
        aggregate.getAverage() == null
            ? null
            : aggregate.getAverage().setScale(2, RoundingMode.HALF_UP);
    return new RoleTrustDto(
        role,
        assignment.getState(),
        assignment.getSuspensionReason(),
        assignment.getSuspensionNote(),
        assignment.getSuspendedAt(),
        average,
        aggregate.getRatingCount(),
        openFlags.stream().filter(flag -> flag.user().role() == role).toList(),
        role == RideParty.DRIVER ? driverPerformanceService.activeWarnings(userId) : List.of(),
        reportService.history(userId, role));
  }

  @Override
  public AdminUserTrustDto suspendRole(UUID actorUserId, UUID userId, RideParty role, String note) {
    suspensionService.suspendRole(actorUserId, userId, role, note);
    return trust(userId);
  }

  @Override
  public AdminUserTrustDto reactivateRole(
      UUID actorUserId, UUID userId, RideParty role, String note) {
    suspensionService.reactivateRole(actorUserId, userId, role, note);
    return trust(userId);
  }

  @Override
  public AdminUserTrustDto suspendAccount(UUID actorUserId, UUID userId, String note) {
    suspensionService.suspendAccount(actorUserId, userId, note);
    return trust(userId);
  }

  @Override
  public AdminUserTrustDto reactivateAccount(UUID actorUserId, UUID userId, String note) {
    suspensionService.reactivateAccount(actorUserId, userId, note);
    return trust(userId);
  }
}
