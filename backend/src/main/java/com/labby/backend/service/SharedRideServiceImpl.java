package com.labby.backend.service;

import com.labby.backend.config.ScheduledProperties;
import com.labby.backend.dto.CancellationQuoteDto;
import com.labby.backend.dto.CreateSharedRideRequestDto;
import com.labby.backend.dto.EstimateDto;
import com.labby.backend.dto.JoinSharedRideRequestDto;
import com.labby.backend.dto.LeaveSharedRideRequestDto;
import com.labby.backend.dto.PlaceDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RiderCancelRequestDto;
import com.labby.backend.dto.RouteDto;
import com.labby.backend.dto.SharedRideDto;
import com.labby.backend.dto.SharedRidePageDto;
import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.SharedDepartureMode;
import com.labby.backend.enums.SharedDispatchTrigger;
import com.labby.backend.enums.SharedMemberStatus;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RiderPreference;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.SharedRide;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RiderPreferenceRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import com.labby.backend.repository.SharedRideRepository;
import com.labby.backend.service.RideAssembler.Audience;
import com.labby.backend.util.GeoPoints;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Public shared rides (RIDE-P1..5). A shared ride is ONE ride row ({@code rides.rider_user_id} =
 * the creator) plus its extension and one member row per party. Every writer — join, leave, start,
 * cancel, the clock, the driver — locks the RIDE row first, so of two joiners racing for the last
 * seat exactly one wins (and {@code ck_shared_rides_seats_taken} backs it at the database).
 */
@Slf4j
@Service
@Transactional
@RequiredArgsConstructor
public class SharedRideServiceImpl implements SharedRideService {

  private static final String NOT_FOUND = "Shared ride not found";

  private static final Set<CancellationReason> CREATOR_CANCEL_REASONS =
      Set.of(CancellationReason.CHANGED_MIND, CancellationReason.OTHER);

  private static final List<SharedMemberStatus> LIVE = List.of(SharedMemberStatus.JOINED);

  /** States in which a member may leave after dispatch (rides-v1 transition 10's states). */
  private static final Set<RideState> LEAVABLE_AFTER_DISPATCH =
      Set.of(RideState.REQUESTED, RideState.OFFERING, RideState.ACCEPTED, RideState.DRIVER_ARRIVED);

  private final RideAccess rideAccess;
  private final RidePricing ridePricing;
  private final RideAssembler rideAssembler;
  private final RideEvents rideEvents;
  private final RideLifecycle rideLifecycle;
  private final ScheduledRideSupport scheduledRideSupport;
  private final ChatService chatService;
  private final RideMoneyService rideMoneyService;
  private final RideRepository rideRepository;
  private final SharedRideRepository sharedRideRepository;
  private final SharedRideMemberRepository sharedRideMemberRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final RiderPreferenceRepository riderPreferenceRepository;
  private final ScheduledProperties scheduledProperties;
  private final TransactionTemplate transactionTemplate;
  private final Clock clock;

  @Override
  public SharedRideDto create(UUID userId, CreateSharedRideRequestDto request) {
    rideAccess.requireActiveRider(userId);
    Region region = ridePricing.regionOf(request.pickup());
    ridePricing.checkRoute(region, request.destination(), List.of());
    ServiceType serviceType =
        serviceTypeRepository
            .findById(request.serviceTypeId())
            .filter(type -> type.getRegionId().equals(region.getId()) && type.isEnabled())
            .orElseThrow(
                () ->
                    new BusinessRuleViolationException(
                            "This service type is not available in the pickup's operating area")
                        .withCode("service_type_unavailable"));
    int maxSeats = sharedRideRepository.maxSeatsServing(serviceType.getId());
    if (request.totalSeats() > maxSeats) {
      throw new BusinessRuleViolationException("No vehicle of this type has that many seats")
          .withCode("seats_unavailable")
          .withDetail("maxSeats", maxSeats);
    }
    if (request.partySize() > request.totalSeats()) {
      throw new BusinessRuleViolationException("Your party is larger than the seats offered")
          .withCode("party_too_large");
    }
    Instant now = clock.instant();
    boolean timed = request.departure().mode() == SharedDepartureMode.AT_TIME;
    if (timed
        && (request.departure().departAt() == null
            || !request.departure().departAt().isAfter(now))) {
      throw new BusinessRuleViolationException("The departure time must be in the future")
          .withCode("departure_in_past");
    }
    requireFree(userId);
    // Priced without surge until dispatch (scheduled-shared-v1: surge locked at dispatch); the
    // surcharge of the departure time (or now for "when full").
    BigDecimal surcharge =
        ridePricing.surchargePercentAt(region, timed ? request.departure().departAt() : now);
    BigDecimal surge = SurgeCalculator.NO_SURGE;
    RouteDto route = ridePricing.route(request.pickup(), List.of(), request.destination());
    EstimateDto estimate =
        ridePricing.estimate(serviceType, region.getCurrency(), route, surcharge, surge);
    Ride ride =
        Ride.builder()
            .riderUserId(userId)
            .regionId(region.getId())
            .serviceTypeId(serviceType.getId())
            .kind(RideKind.SHARED)
            .state(RideState.GATHERING)
            .pickup(GeoPoints.point(request.pickup().lat(), request.pickup().lng()))
            .pickupLabel(request.pickup().label())
            .destination(GeoPoints.point(request.destination().lat(), request.destination().lng()))
            .destinationLabel(request.destination().label())
            .stops(new ArrayList<>())
            .paymentMethod(request.paymentMethod())
            .pickupDistanceMode(preferences(userId).getPickupDistanceMode())
            .currency(region.getCurrency())
            .surgeMultiplier(surge)
            .surchargePercent(surcharge)
            .requestedAt(now)
            .build();
    scheduledRideSupport.applyEstimate(ride, estimate);
    ride = rideRepository.saveAndFlush(ride);
    SharedRide shared =
        sharedRideRepository.saveAndFlush(
            SharedRide.builder()
                .rideId(ride.getId())
                .totalSeats(request.totalSeats().shortValue())
                .seatsTaken(request.partySize().shortValue())
                .departureMode(request.departure().mode())
                .departureAt(timed ? request.departure().departAt() : null)
                .expiresAt(
                    timed
                        ? null
                        : now.plus(
                            Duration.ofHours(scheduledProperties.sharedWhenFullExpiryHours())))
                .build());
    sharedRideMemberRepository.saveAndFlush(
        SharedRideMember.builder()
            .rideId(ride.getId())
            .riderUserId(userId)
            .creator(true)
            .partySize(request.partySize().shortValue())
            .paymentMethod(request.paymentMethod())
            .joinedAt(now)
            .build());
    if (shared.seatsLeft() == 0) {
      dispatch(ride, shared, SharedDispatchTrigger.FULL, now);
    } else {
      rideEvents.stateChanged(ride);
    }
    return rideAssembler.sharedRide(ride, shared, userId);
  }

  @Override
  @Transactional(readOnly = true)
  public SharedRidePageDto browse(UUID userId, BrowseCriteria criteria, int page, int size) {
    rideAccess.requireRider(userId);
    Region region = ridePricing.regionOf(new PlaceDto(criteria.lat(), criteria.lng(), null));
    boolean byDestination = criteria.destLat() != null && criteria.destLng() != null;
    Page<UUID> ids =
        sharedRideRepository.browse(
            region.getId(),
            byDestination ? criteria.destLat() : null,
            byDestination ? criteria.destLng() : null,
            (double) criteria.destRadiusM(),
            criteria.departFrom(),
            criteria.departTo(),
            PageRequest.of(page, size));
    List<SharedRideDto> items =
        ids.getContent().stream()
            .map(
                id ->
                    rideAssembler.sharedRide(
                        rideRepository.findById(id).orElseThrow(),
                        sharedRideRepository.findById(id).orElseThrow(),
                        userId))
            .toList();
    return new SharedRidePageDto(items, page, size, ids.getTotalElements());
  }

  @Override
  @Transactional(readOnly = true)
  public SharedRideDto mineOpen(UUID userId) {
    rideAccess.requireRider(userId);
    UUID rideId =
        sharedRideMemberRepository
            .findGatheringRideId(userId)
            .orElseThrow(
                () ->
                    (ResourceNotFoundException)
                        new ResourceNotFoundException("You have no open shared ride")
                            .withCode("no_open_shared_ride"));
    return rideAssembler.sharedRide(
        rideRepository.findById(rideId).orElseThrow(),
        sharedRideRepository.findById(rideId).orElseThrow(),
        userId);
  }

  @Override
  @Transactional(readOnly = true)
  public SharedRideDto get(UUID userId, UUID rideId) {
    rideAccess.requireRider(userId);
    Ride ride = rideRepository.findById(rideId).filter(this::isShared).orElseThrow(this::notFound);
    if (ride.getState() != RideState.GATHERING
        && sharedRideMemberRepository
            .findFirstByRideIdAndRiderUserIdOrderByJoinedAtDesc(rideId, userId)
            .isEmpty()) {
      throw notFound();
    }
    return rideAssembler.sharedRide(
        ride, sharedRideRepository.findById(rideId).orElseThrow(), userId);
  }

  @Override
  public SharedRideDto join(UUID userId, UUID rideId, JoinSharedRideRequestDto request) {
    rideAccess.requireActiveRider(userId);
    Ride ride = lockShared(rideId);
    SharedRide shared = sharedRideRepository.findById(rideId).orElseThrow();
    if (ride.getState() != RideState.GATHERING) {
      throw closed();
    }
    if (sharedRideMemberRepository
        .findFirstByRideIdAndRiderUserIdAndStatusIn(rideId, userId, LIVE)
        .isPresent()) {
      throw (ConflictException)
          new ConflictException("You already joined this ride").withCode("already_member");
    }
    requireFree(userId);
    if (shared.seatsLeft() < request.partySize()) {
      // UC-R-13 E1 — also the loser of a last-seat race (the winner holds the lock first).
      throw (ConflictException)
          new ConflictException("Not enough seats left for your party")
              .withCode("insufficient_seats")
              .withDetail("seatsLeft", shared.seatsLeft());
    }
    Instant now = clock.instant();
    sharedRideMemberRepository.saveAndFlush(
        SharedRideMember.builder()
            .rideId(rideId)
            .riderUserId(userId)
            .creator(false)
            .partySize(request.partySize().shortValue())
            .paymentMethod(request.paymentMethod())
            .joinedAt(now)
            .build());
    shared.setSeatsTaken((short) (shared.getSeatsTaken() + request.partySize()));
    shared = sharedRideRepository.saveAndFlush(shared);
    if (shared.seatsLeft() == 0) {
      dispatch(ride, shared, SharedDispatchTrigger.FULL, now);
    } else {
      rideEvents.sharedOccupancy(ride, shared.getSeatsTaken(), shared.getTotalSeats());
    }
    return rideAssembler.sharedRide(ride, shared, userId);
  }

  @Override
  @Transactional(readOnly = true)
  public CancellationQuoteDto leaveQuote(UUID userId, UUID rideId) {
    rideAccess.requireRider(userId);
    Ride ride = rideRepository.findById(rideId).filter(this::isShared).orElseThrow(this::notFound);
    sharedRideMemberRepository
        .findFirstByRideIdAndRiderUserIdAndStatusIn(rideId, userId, LIVE)
        .orElseThrow(this::notFound);
    Instant now = clock.instant();
    BigDecimal fee =
        ride.getState() == RideState.GATHERING
            ? null
            : rideLifecycle.riderCancellationFee(ride, now);
    Instant graceEndsAt =
        ride.getCancellationGraceEndsAt() != null && now.isBefore(ride.getCancellationGraceEndsAt())
            ? ride.getCancellationGraceEndsAt()
            : null;
    return new CancellationQuoteDto(
        fee == null, fee, fee == null ? null : ride.getCurrency(), graceEndsAt);
  }

  @Override
  public SharedRideDto leave(UUID userId, UUID rideId, LeaveSharedRideRequestDto request) {
    rideAccess.requireRider(userId);
    Ride ride = lockShared(rideId);
    SharedRide shared = sharedRideRepository.findById(rideId).orElseThrow();
    SharedRideMember member =
        sharedRideMemberRepository
            .findFirstByRideIdAndRiderUserIdAndStatusIn(rideId, userId, LIVE)
            .orElseThrow(this::notFound);
    Instant now = clock.instant();
    if (ride.getState() == RideState.GATHERING) {
      if (member.isCreator()) {
        throw (ConflictException)
            new ConflictException("Cancel the ride instead — you created it")
                .withCode("creator_must_cancel");
      }
      member.setStatus(SharedMemberStatus.LEFT);
      member.setLeftAt(now);
      sharedRideMemberRepository.saveAndFlush(member);
      shared = freeSeats(shared, member);
      rideEvents.sharedOccupancy(ride, shared.getSeatsTaken(), shared.getTotalSeats());
      return rideAssembler.sharedRide(ride, shared, userId);
    }
    if (!LEAVABLE_AFTER_DISPATCH.contains(ride.getState())) {
      throw RideLifecycle.illegalState(ride);
    }
    // RIDE-P5: after dispatch leaving is this member's RIDE-07 cancellation.
    if (request == null
        || request.reason() == null
        || !RiderRideServiceImpl.RIDER_REASONS.contains(request.reason())) {
      throw new InvalidRequestException("Please choose why you are cancelling");
    }
    RiderRideServiceImpl.requireNoteForOther(request.reason(), request.note());
    member.setStatus(SharedMemberStatus.CANCELLED);
    member.setLeftAt(now);
    member.setCancellationReason(request.reason());
    member.setCancellationNote(RiderRideServiceImpl.blankToNull(request.note()));
    member.setCancellationFee(rideLifecycle.riderCancellationFee(ride, now));
    sharedRideMemberRepository.saveAndFlush(member);
    if (member.getCancellationFee() != null) {
      // RIDE-07 per member: collected by THEIR payment method (money-v1).
      rideMoneyService.collectMemberFee(ride, member);
    }
    // CHAT-01 per thread: the member's private thread closes 24 h after their exit.
    chatService.closeMemberThread(rideId, userId, now);
    shared = freeSeats(shared, member);
    if (joined(rideId).isEmpty()) {
      endWithoutRiders(ride, request.reason(), now);
    } else {
      rideEvents.updated(ride, "member_left");
    }
    return rideAssembler.sharedRide(ride, shared, userId);
  }

  @Override
  public SharedRideDto start(UUID userId, UUID rideId) {
    rideAccess.requireActiveRider(userId);
    Ride ride = lockShared(rideId);
    requireCreator(ride, userId);
    if (ride.getState() != RideState.GATHERING) {
      throw RideLifecycle.illegalState(ride);
    }
    SharedRide shared = sharedRideRepository.findById(rideId).orElseThrow();
    dispatch(ride, shared, SharedDispatchTrigger.CREATOR, clock.instant());
    return rideAssembler.sharedRide(ride, shared, userId);
  }

  @Override
  public SharedRideDto cancel(UUID userId, UUID rideId, RiderCancelRequestDto request) {
    rideAccess.requireRider(userId);
    if (!CREATOR_CANCEL_REASONS.contains(request.reason())) {
      throw new InvalidRequestException("This cancellation reason is not available here");
    }
    RiderRideServiceImpl.requireNoteForOther(request.reason(), request.note());
    Ride ride = lockShared(rideId);
    requireCreator(ride, userId);
    if (ride.getState() != RideState.GATHERING) {
      throw RideLifecycle.illegalState(ride);
    }
    cancelGroup(
        ride,
        request.reason(),
        RiderRideServiceImpl.blankToNull(request.note()),
        "creator_cancelled",
        false,
        clock.instant());
    return rideAssembler.sharedRide(
        ride, sharedRideRepository.findById(rideId).orElseThrow(), userId);
  }

  @Override
  public RideDto markNoShow(UUID driverUserId, UUID rideId, UUID memberId) {
    rideAccess.requireDriver(driverUserId);
    Ride ride = lockShared(rideId);
    if (!driverUserId.equals(ride.getDriverUserId())) {
      throw new ForbiddenException("This is not your ride");
    }
    SharedRideMember member = memberOf(rideId, memberId);
    if (ride.getState() != RideState.DRIVER_ARRIVED || !member.isJoined()) {
      throw RideLifecycle.illegalState(ride);
    }
    Instant now = clock.instant();
    Instant waitGraceEndsAt =
        ride.getDriverArrivedAt()
            .plusSeconds(60L * rideAssembler.waitGraceMinutes(ride.getRegionId()));
    if (now.isBefore(waitGraceEndsAt)) {
      throw (ConflictException)
          new ConflictException("Wait until the member's wait time is over")
              .withCode("wait_grace_running")
              .withDetail("waitGraceEndsAt", waitGraceEndsAt.toString());
    }
    member.setStatus(SharedMemberStatus.NO_SHOW);
    member.setNoShowAt(now);
    member.setCancellationFee(rideLifecycle.regionFee(ride.getRegionId()));
    sharedRideMemberRepository.saveAndFlush(member);
    if (member.getCancellationFee() != null) {
      rideMoneyService.collectMemberFee(ride, member);
    }
    chatService.closeMemberThread(rideId, member.getRiderUserId(), now);
    SharedRide shared = sharedRideRepository.findById(rideId).orElseThrow();
    freeSeats(shared, member);
    Map<String, Object> params = new HashMap<>();
    params.put("rideId", rideId.toString());
    if (member.getCancellationFee() != null) {
      params.put("fee", member.getCancellationFee().toPlainString());
      params.put("currency", ride.getCurrency());
    }
    rideEvents.push(member.getRiderUserId(), NotificationEvent.SHARED_MEMBER_NO_SHOW, params);
    if (joined(rideId).isEmpty()) {
      // Every party is absent: the rides-v1 rider_no_show end — no re-dispatch.
      ride.setState(RideState.CANCELLED_BY_DRIVER);
      ride.setCancelledAt(now);
      ride.setCancellationReason(CancellationReason.RIDER_NO_SHOW);
      ride.setCancellationFee(null);
      ride = rideRepository.saveAndFlush(ride);
      chatService.closeThread(rideId, now);
      rideEvents.stateChanged(ride);
      rideLifecycle.releaseDriver(driverUserId, now);
    } else {
      rideEvents.updated(ride, "member_no_show");
    }
    return rideAssembler.view(ride, Audience.DRIVER);
  }

  @Override
  public RideDto confirmMemberCash(UUID driverUserId, UUID rideId, UUID memberId) {
    return settleMember(driverUserId, rideId, memberId, null, "payment_confirmed");
  }

  @Override
  public RideDto markMemberUnpaid(UUID driverUserId, UUID rideId, UUID memberId) {
    return settleMember(driverUserId, rideId, memberId, PaymentStatus.UNPAID, "payment_unpaid");
  }

  /** The per-member rides-v1 cash-confirm (status null) / mark-unpaid. */
  private RideDto settleMember(
      UUID driverUserId, UUID rideId, UUID memberId, PaymentStatus status, String reason) {
    rideAccess.requireDriver(driverUserId);
    Ride ride = lockShared(rideId);
    if (!driverUserId.equals(ride.getDriverUserId())) {
      throw new ForbiddenException("This is not your ride");
    }
    SharedRideMember member = memberOf(rideId, memberId);
    if (ride.getState() != RideState.COMPLETED
        || member.getPaymentStatus() != PaymentStatus.PENDING) {
      throw RideLifecycle.illegalState(ride);
    }
    if (status == null) {
      status = rideMoneyService.confirmMemberCash(ride, member);
    } else {
      rideMoneyService.releaseMemberCarriedDues(ride, member);
    }
    Instant now = clock.instant();
    member.setPaymentStatus(status);
    member.setPaymentConfirmedAt(now);
    sharedRideMemberRepository.saveAndFlush(member);
    if (!sharedRideMemberRepository.existsByRideIdAndPaymentStatus(rideId, PaymentStatus.PENDING)) {
      ride.setPaymentConfirmedAt(now);
      ride = rideRepository.saveAndFlush(ride);
    }
    rideEvents.updated(ride, reason);
    return rideAssembler.view(ride, Audience.DRIVER);
  }

  @Override
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  public int processDue() {
    int changed = 0;
    for (UUID rideId :
        sharedRideRepository.findDue(clock.instant(), scheduledProperties.batchSize())) {
      try {
        if (Boolean.TRUE.equals(transactionTemplate.execute(status -> step(rideId)))) {
          changed++;
        }
      } catch (RuntimeException ex) {
        log.warn("Shared ride step failed for {}: {}", rideId, ex.getClass().getSimpleName());
      }
    }
    return changed;
  }

  private boolean step(UUID rideId) {
    Optional<Ride> locked = rideRepository.lockIfFree(rideId);
    if (locked.isEmpty() || locked.get().getState() != RideState.GATHERING) {
      return false;
    }
    Ride ride = locked.get();
    SharedRide shared = sharedRideRepository.findById(rideId).orElseThrow();
    Instant now = clock.instant();
    if (shared.getDepartureAt() != null && !now.isBefore(shared.getDepartureAt())) {
      // Ruling 2026-10-16: a timed ride leaves at its time with whoever joined.
      dispatch(ride, shared, SharedDispatchTrigger.DEPARTURE_TIME, now);
      return true;
    }
    if (shared.getExpiresAt() != null && !now.isBefore(shared.getExpiresAt())) {
      // Ruling 2026-10-16: a "when full" ride unfilled for 24 h is cancelled, everyone told.
      cancelGroup(ride, CancellationReason.SHARED_EXPIRED, null, "expired", true, now);
      return true;
    }
    return false;
  }

  @Override
  public List<SharedRideMember> settleSplit(Ride ride, Fare fare) {
    List<SharedRideMember> boarded = joined(ride.getId());
    SharedFareSplitter.Split split =
        SharedFareSplitter.split(
            fare.getTotal(),
            boarded.stream()
                .map(
                    member ->
                        new SharedFareSplitter.Party(
                            member.getId(), member.getPartySize(), member.isCreator()))
                .toList());
    for (SharedRideMember member : boarded) {
      member.setStatus(SharedMemberStatus.COMPLETED);
      member.setShareAmount(split.shares().get(member.getId()));
      member.setPaymentStatus(PaymentStatus.PENDING);
    }
    sharedRideMemberRepository.saveAllAndFlush(boarded);
    SharedRide shared = sharedRideRepository.findById(ride.getId()).orElseThrow();
    shared.setSplitSeats((short) split.boardedSeats());
    shared.setPerSeatAmount(split.perSeatAmount());
    sharedRideRepository.saveAndFlush(shared);
    return boarded;
  }

  @Override
  public void copyForRedispatch(Ride cancelled, Ride redispatched, Instant now) {
    SharedRide old = sharedRideRepository.findById(cancelled.getId()).orElseThrow();
    sharedRideRepository.saveAndFlush(
        SharedRide.builder()
            .rideId(redispatched.getId())
            .totalSeats(old.getTotalSeats())
            .seatsTaken(old.getSeatsTaken())
            .departureMode(old.getDepartureMode())
            .departureAt(old.getDepartureAt())
            .expiresAt(old.getExpiresAt())
            .dispatchTrigger(old.getDispatchTrigger())
            .dispatchedAt(now)
            .build());
    sharedRideMemberRepository.saveAllAndFlush(
        joined(cancelled.getId()).stream()
            .map(
                member ->
                    SharedRideMember.builder()
                        .rideId(redispatched.getId())
                        .riderUserId(member.getRiderUserId())
                        .creator(member.isCreator())
                        .partySize(member.getPartySize())
                        .paymentMethod(member.getPaymentMethod())
                        .joinedAt(member.getJoinedAt())
                        .build())
            .toList());
  }

  @Override
  public void onAccountSuspended(UUID userId, Instant now) {
    for (UUID rideId : sharedRideMemberRepository.findPreAcceptanceRidesOfMember(userId)) {
      Ride ride = rideLifecycle.lock(rideId);
      Optional<SharedRideMember> found =
          sharedRideMemberRepository.findFirstByRideIdAndRiderUserIdAndStatusIn(
              rideId, userId, LIVE);
      if (found.isEmpty()) {
        continue;
      }
      SharedRideMember member = found.get();
      if (ride.getState() == RideState.GATHERING && member.isCreator()) {
        cancelGroup(
            ride, CancellationReason.ACCOUNT_SUSPENDED, null, "account_suspended", false, now);
        continue;
      }
      if (ride.getState() != RideState.GATHERING
          && ride.getState() != RideState.REQUESTED
          && ride.getState() != RideState.OFFERING) {
        continue;
      }
      member.setStatus(SharedMemberStatus.LEFT);
      member.setLeftAt(now);
      sharedRideMemberRepository.saveAndFlush(member);
      SharedRide shared = freeSeats(sharedRideRepository.findById(rideId).orElseThrow(), member);
      if (joined(rideId).isEmpty()) {
        endWithoutRiders(ride, CancellationReason.ACCOUNT_SUSPENDED, now);
      } else if (ride.getState() == RideState.GATHERING) {
        rideEvents.sharedOccupancy(ride, shared.getSeatsTaken(), shared.getTotalSeats());
      } else {
        rideEvents.updated(ride, "member_left");
      }
    }
  }

  /**
   * P2: the group goes into live dispatch — surge locked NOW, estimate recomputed, {@code
   * requested_at} restarts so the rides-v1 give-up clock counts from dispatch.
   */
  private void dispatch(Ride ride, SharedRide shared, SharedDispatchTrigger trigger, Instant now) {
    // Review H2 (owner ruling 2026-10-17): a member already on another live ride is dropped free;
    // if that is the creator, the group is cancelled instead (the booking rules make this rare).
    for (SharedRideMember member : joined(ride.getId())) {
      if (!onAnotherLiveRide(member.getRiderUserId())) {
        continue;
      }
      if (member.isCreator()) {
        cancelGroup(ride, CancellationReason.RIDER_BUSY, null, "creator_busy", false, now);
        rideEvents.push(
            member.getRiderUserId(),
            NotificationEvent.SHARED_CANCELLED,
            Map.of("rideId", ride.getId().toString(), "reason", "own_ride_busy"));
        return;
      }
      member.setStatus(SharedMemberStatus.LEFT);
      member.setLeftAt(now);
      sharedRideMemberRepository.saveAndFlush(member);
      shared = freeSeats(shared, member);
      rideEvents.push(
          member.getRiderUserId(),
          NotificationEvent.SHARED_CANCELLED,
          Map.of("rideId", ride.getId().toString(), "reason", "rider_busy"));
    }
    scheduledRideSupport.repriceForExecution(ride, scheduledRideSupport.region(ride), now);
    ride.setState(RideState.REQUESTED);
    ride.setRequestedAt(now);
    rideRepository.saveAndFlush(ride);
    shared.setDispatchTrigger(trigger);
    shared.setDispatchedAt(now);
    sharedRideRepository.saveAndFlush(shared);
    rideEvents.stateChanged(ride);
    rideEvents.pushRiders(
        ride,
        NotificationEvent.SHARED_DISPATCHED,
        Map.of("rideId", ride.getId().toString(), "trigger", trigger.getValue()));
  }

  /** P3: the gathering group ends; every joined member is set {@code left} and told. */
  private void cancelGroup(
      Ride ride,
      CancellationReason reason,
      String note,
      String pushReason,
      boolean tellCreator,
      Instant now) {
    List<SharedRideMember> members = joined(ride.getId());
    ride.setState(RideState.CANCELLED_BY_RIDER);
    ride.setCancelledAt(now);
    ride.setCancellationReason(reason);
    ride.setCancellationNote(note);
    ride.setCancellationFee(null);
    rideRepository.saveAndFlush(ride);
    for (SharedRideMember member : members) {
      member.setStatus(SharedMemberStatus.LEFT);
      member.setLeftAt(now);
    }
    sharedRideMemberRepository.saveAllAndFlush(members);
    rideEvents.stateChanged(ride);
    for (SharedRideMember member : members) {
      if (tellCreator || !member.isCreator()) {
        rideEvents.push(
            member.getRiderUserId(),
            NotificationEvent.SHARED_CANCELLED,
            Map.of("rideId", ride.getId().toString(), "reason", pushReason));
      }
    }
  }

  /** The last party left after dispatch: the ride ends like a rider cancellation (no ride fee). */
  private void endWithoutRiders(Ride ride, CancellationReason reason, Instant now) {
    UUID driverUserId = ride.getDriverUserId();
    rideLifecycle.withdrawOpenOffer(ride, now);
    ride.setState(RideState.CANCELLED_BY_RIDER);
    ride.setCancelledAt(now);
    ride.setCancellationReason(reason);
    ride.setCancellationFee(null);
    rideRepository.saveAndFlush(ride);
    chatService.closeThread(ride.getId(), now);
    rideEvents.stateChanged(ride);
    if (driverUserId != null) {
      rideEvents.push(
          driverUserId,
          NotificationEvent.RIDE_CANCELLED_BY_RIDER,
          Map.of("rideId", ride.getId().toString()));
      rideLifecycle.releaseDriver(driverUserId, now);
    }
  }

  /** On a live own ride, or a joined member of another live shared ride. */
  private boolean onAnotherLiveRide(UUID riderUserId) {
    return rideRepository.findOwnActive(riderUserId, RideRepository.ACTIVE_STATES).isPresent()
        || sharedRideMemberRepository.findLiveRideOfMember(riderUserId).isPresent();
  }

  private SharedRide freeSeats(SharedRide shared, SharedRideMember member) {
    shared.setSeatsTaken((short) Math.max(0, shared.getSeatsTaken() - member.getPartySize()));
    return sharedRideRepository.saveAndFlush(shared);
  }

  private SharedRideMember memberOf(UUID rideId, UUID memberId) {
    return sharedRideMemberRepository
        .findById(memberId)
        .filter(found -> found.getRideId().equals(rideId))
        .orElseThrow(() -> new ResourceNotFoundException("Member not found"));
  }

  private List<SharedRideMember> joined(UUID rideId) {
    return sharedRideMemberRepository.findByRideIdAndStatusOrderByJoinedAtAsc(
        rideId, SharedMemberStatus.JOINED);
  }

  /**
   * One gathering or live shared membership at a time, and none while on a live own ride — checked
   * under the rider's own lock (review W12), so two joins of one rider cannot both pass.
   */
  private void requireFree(UUID userId) {
    rideRepository.lockRider(userId);
    if (sharedRideMemberRepository.existsOpenMembership(userId)
        || rideRepository.findOwnActive(userId, RideRepository.ACTIVE_STATES).isPresent()) {
      throw (ConflictException)
          new ConflictException("You already have an active ride").withCode("active_ride_exists");
    }
  }

  private void requireCreator(Ride ride, UUID userId) {
    if (!ride.getRiderUserId().equals(userId)) {
      throw new ForbiddenException("Only the ride's creator can do this");
    }
  }

  /** Locks FIRST, then checks it is a shared ride (anything else is a plain 404). */
  private Ride lockShared(UUID rideId) {
    Ride ride;
    try {
      ride = rideLifecycle.lock(rideId);
    } catch (ResourceNotFoundException ex) {
      throw notFound();
    }
    if (!isShared(ride)) {
      throw notFound();
    }
    return ride;
  }

  private boolean isShared(Ride ride) {
    return ride.getKind() == RideKind.SHARED;
  }

  private ResourceNotFoundException notFound() {
    return new ResourceNotFoundException(NOT_FOUND);
  }

  private static ConflictException closed() {
    return (ConflictException)
        new ConflictException("This shared ride is no longer open").withCode("shared_ride_closed");
  }

  private RiderPreference preferences(UUID userId) {
    return riderPreferenceRepository
        .findById(userId)
        .orElseGet(() -> RiderPreference.defaults(userId));
  }
}
