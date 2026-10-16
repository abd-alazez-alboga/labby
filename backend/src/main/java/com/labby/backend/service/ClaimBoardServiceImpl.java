package com.labby.backend.service;

import com.labby.backend.dto.ClaimBoardEntryDto;
import com.labby.backend.dto.ClaimBoardPageDto;
import com.labby.backend.dto.ClaimReleaseRequestDto;
import com.labby.backend.dto.PlaceDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.ClaimReleaseReason;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.ScheduledRide;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.User;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.ScheduledRideRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.repository.VehicleRepository;
import com.labby.backend.service.RideAssembler.Audience;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The claim board (RIDE-S2, UC-D-11/12). Claim and release lock the RIDE row first (rides-v1
 * concurrency): of two drivers claiming at once exactly one wins, the other gets {@code
 * already_claimed}. The board query and the claim re-check share the same SQL rules
 * (ScheduledRideRepository).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class ClaimBoardServiceImpl implements ClaimBoardService {

  /** The reasons a driver may give (scheduled-shared-v1 ClaimReleaseRequest). */
  private static final Set<ClaimReleaseReason> DRIVER_REASONS =
      Set.of(
          ClaimReleaseReason.VEHICLE_ISSUE,
          ClaimReleaseReason.UNSAFE_PICKUP,
          ClaimReleaseReason.OTHER);

  private static final String NOT_FOUND = "Scheduled ride not found";

  private final RideAccess rideAccess;
  private final RideAssembler rideAssembler;
  private final RideEvents rideEvents;
  private final RideLifecycle rideLifecycle;
  private final ScheduledRideSupport scheduledRideSupport;
  private final RideRepository rideRepository;
  private final ScheduledRideRepository scheduledRideRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final VehicleRepository vehicleRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final UserRepository userRepository;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public ClaimBoardPageDto board(UUID driverUserId, int page, int size) {
    rideAccess.requireDriver(driverUserId);
    if (!dutyAllowed(driverUserId)) {
      return new ClaimBoardPageDto(List.of(), page, size, 0);
    }
    Page<UUID> ids =
        scheduledRideRepository.findBoard(
            driverUserId, clock.instant(), PageRequest.of(page, size));
    Map<UUID, Ride> rides =
        rideRepository.findAllById(ids.getContent()).stream()
            .collect(Collectors.toMap(Ride::getId, Function.identity()));
    Map<UUID, ScheduledRide> scheduled =
        scheduledRideRepository.findAllById(ids.getContent()).stream()
            .collect(Collectors.toMap(ScheduledRide::getRideId, Function.identity()));
    List<ClaimBoardEntryDto> items =
        ids.getContent().stream().map(id -> entry(rides.get(id), scheduled.get(id))).toList();
    return new ClaimBoardPageDto(items, page, size, ids.getTotalElements());
  }

  @Override
  public RideDto claim(UUID driverUserId, UUID rideId) {
    rideAccess.requireDriver(driverUserId);
    Ride ride = lockScheduled(rideId);
    ScheduledRide scheduled = scheduledRideRepository.findById(rideId).orElseThrow();
    Instant now = clock.instant();
    Region region = scheduledRideSupport.region(ride);
    ScheduledRules.Settings settings = scheduledRideSupport.settings(region);
    if (ride.getState() != RideState.SCHEDULED || scheduled.isExecuted()) {
      throw claimClosed();
    }
    if (scheduled.isClaimed()) {
      if (driverUserId.equals(scheduled.getClaimedDriverUserId())) {
        return rideAssembler.view(ride, Audience.DRIVER);
      }
      throw (ConflictException)
          new ConflictException("Another driver already claimed this ride")
              .withCode("already_claimed");
    }
    if (!now.isBefore(settings.executeAt(scheduled.getScheduledAt()))) {
      throw claimClosed();
    }
    if (!dutyAllowed(driverUserId) || ride.getRiderUserId().equals(driverUserId)) {
      throw notEligible("driver");
    }
    Vehicle vehicle =
        vehicleRepository
            .findByDriverUserIdAndActiveTrue(driverUserId)
            .orElseThrow(() -> notEligible("service_type"));
    ScheduledRideRepository.ClaimEligibility eligibility =
        scheduledRideRepository.eligibility(rideId, driverUserId);
    if (!eligibility.getServiceTypeMatches()) {
      throw notEligible("service_type");
    }
    if (!eligibility.getWindowCovered()) {
      throw notEligible("window");
    }
    scheduled.setClaimedDriverUserId(driverUserId);
    scheduled.setClaimedVehicleId(vehicle.getId());
    scheduled.setClaimedAt(now);
    scheduledRideSupport.skipPastTiers(scheduled, settings, now, true);
    scheduledRideRepository.saveAndFlush(scheduled);
    Map<String, Object> params = scheduledRideSupport.pickupParams(ride, scheduled, region);
    params.put("driverName", driverFirstName(driverUserId));
    rideEvents.push(ride.getRiderUserId(), NotificationEvent.SCHEDULED_CLAIMED, params);
    rideEvents.updated(ride, "scheduled_claimed");
    return rideAssembler.view(ride, Audience.DRIVER);
  }

  @Override
  public void release(UUID driverUserId, UUID rideId, ClaimReleaseRequestDto request) {
    rideAccess.requireDriver(driverUserId);
    if (!DRIVER_REASONS.contains(request.reason())) {
      throw new InvalidRequestException("This release reason is not available to drivers");
    }
    String note = RiderRideServiceImpl.blankToNull(request.note());
    if (request.reason() == ClaimReleaseReason.OTHER && note == null) {
      throw new InvalidRequestException("Please describe the reason");
    }
    Ride ride = lockScheduled(rideId);
    ScheduledRide scheduled = scheduledRideRepository.findById(rideId).orElseThrow();
    if (!driverUserId.equals(scheduled.getClaimedDriverUserId())) {
      throw new ForbiddenException("This ride is not claimed by you");
    }
    if (ride.getState() != RideState.SCHEDULED || scheduled.isExecuted()) {
      throw RideLifecycle.illegalState(ride);
    }
    scheduledRideSupport.release(ride, scheduled, request.reason(), note, clock.instant());
  }

  @Override
  @Transactional(readOnly = true)
  public List<RideDto> claims(UUID driverUserId) {
    rideAccess.requireDriver(driverUserId);
    List<UUID> ids = scheduledRideRepository.findPendingClaims(driverUserId);
    Map<UUID, Ride> rides =
        rideRepository.findAllById(ids).stream()
            .collect(Collectors.toMap(Ride::getId, Function.identity()));
    return ids.stream().map(id -> rideAssembler.view(rides.get(id), Audience.DRIVER)).toList();
  }

  private ClaimBoardEntryDto entry(Ride ride, ScheduledRide scheduled) {
    ServiceType serviceType = serviceTypeRepository.findById(ride.getServiceTypeId()).orElseThrow();
    PlaceDto pickup = rideAssembler.place(ride.getPickup(), ride.getPickupLabel());
    return new ClaimBoardEntryDto(
        ride.getId(),
        scheduled.getScheduledAt(),
        // UC-D-11 "pickup area": ≈ 100 m until claimed (scheduled-shared-v1 Claim board).
        new PlaceDto(area(pickup.lat()), area(pickup.lng()), pickup.label()),
        rideAssembler.place(ride.getDestination(), ride.getDestinationLabel()),
        ride.getStops().size(),
        serviceType.getId(),
        serviceType.getNameEn(),
        serviceType.getNameAr(),
        ride.getEstimateTotal(),
        ride.getCurrency(),
        true,
        ride.getPaymentMethod(),
        ride.getEstimateDistanceM(),
        ride.getEstimateDurationS());
  }

  /** Locks FIRST, then checks it is a scheduled ride (anything else is a plain 404). */
  private Ride lockScheduled(UUID rideId) {
    Ride ride;
    try {
      ride = rideLifecycle.lock(rideId);
    } catch (ResourceNotFoundException ex) {
      throw new ResourceNotFoundException(NOT_FOUND);
    }
    if (ride.getKind() != RideKind.SCHEDULED) {
      throw new ResourceNotFoundException(NOT_FOUND);
    }
    return ride;
  }

  /** Driver role and account active (the board gates; online is not required). */
  private boolean dutyAllowed(UUID driverUserId) {
    boolean roleActive =
        roleAssignmentRepository
            .findByUserIdAndRole(driverUserId, Role.DRIVER)
            .map(role -> role.getState() == RoleState.ACTIVE)
            .orElse(false);
    boolean accountActive =
        userRepository
            .findById(driverUserId)
            .map(user -> user.getState() == AccountState.ACTIVE)
            .orElse(false);
    return roleActive && accountActive;
  }

  private String driverFirstName(UUID userId) {
    return userRepository
        .findById(userId)
        .map(User::getName)
        .map(RideAssembler::firstName)
        .orElse("");
  }

  private static Double area(Double coordinate) {
    return BigDecimal.valueOf(coordinate).setScale(3, RoundingMode.HALF_UP).doubleValue();
  }

  private static ConflictException claimClosed() {
    return (ConflictException)
        new ConflictException("This ride can no longer be claimed").withCode("claim_closed");
  }

  private static BusinessRuleViolationException notEligible(String rule) {
    return (BusinessRuleViolationException)
        new BusinessRuleViolationException("You can't claim this ride")
            .withCode("not_eligible")
            .withDetail("rule", rule);
  }
}
