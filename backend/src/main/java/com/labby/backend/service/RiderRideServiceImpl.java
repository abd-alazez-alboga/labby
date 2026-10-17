package com.labby.backend.service;

import com.labby.backend.dto.BookRideRequestDto;
import com.labby.backend.dto.CancellationQuoteDto;
import com.labby.backend.dto.EstimateDto;
import com.labby.backend.dto.EstimateResponseDto;
import com.labby.backend.dto.FinalFareDto;
import com.labby.backend.dto.GeoJsonLineStringDto;
import com.labby.backend.dto.PickupFeeRuleDto;
import com.labby.backend.dto.PlaceDto;
import com.labby.backend.dto.ReceiptDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RideSummaryPageDto;
import com.labby.backend.dto.RiderCancelRequestDto;
import com.labby.backend.dto.RouteChangeRequestDto;
import com.labby.backend.dto.RouteDto;
import com.labby.backend.dto.RouteInputDto;
import com.labby.backend.dto.RouteSummaryDto;
import com.labby.backend.dto.ServiceTypeEstimateDto;
import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.PickupDistanceMode;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.SharedMemberStatus;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RiderPreference;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.repository.FareRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RiderPreferenceRepository;
import com.labby.backend.repository.ScheduledRideRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import com.labby.backend.service.RideAssembler.Audience;
import com.labby.backend.util.GeoPoints;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Rider actions. Every state change locks the ride row first (one winner per race, rides-v1
 * concurrency); the database's one-active-ride-per-rider index backs the UC-R-04 E4 check against
 * double-tap bookings. Another rider's ride is a plain 404.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class RiderRideServiceImpl implements RiderRideService {

  /** The reasons a rider may give (rides-v1 RiderCancelRequest). */
  static final Set<CancellationReason> RIDER_REASONS =
      Set.of(
          CancellationReason.CHANGED_MIND,
          CancellationReason.DRIVER_TOO_FAR,
          CancellationReason.WRONG_PICKUP,
          CancellationReason.OTHER);

  private static final String NOT_FOUND = "Ride not found";

  private final RideAccess rideAccess;
  private final RidePricing ridePricing;
  private final RideAssembler rideAssembler;
  private final RideEvents rideEvents;
  private final RideLifecycle rideLifecycle;
  private final RideMoneyService rideMoneyService;
  private final ChatService chatService;
  private final RideRepository rideRepository;
  private final FareRepository fareRepository;
  private final RegionRepository regionRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final RiderPreferenceRepository riderPreferenceRepository;
  private final ScheduledRideRepository scheduledRideRepository;
  private final SharedRideMemberRepository sharedRideMemberRepository;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public EstimateResponseDto estimate(UUID userId, RouteInputDto request) {
    rideAccess.requireRider(userId);
    Region region = ridePricing.regionOf(request.pickup());
    ridePricing.checkRoute(region, request.destination(), request.stops());
    RouteDto route = ridePricing.route(request.pickup(), request.stops(), request.destination());
    // M12 (RIDE-S1): a scheduled estimate uses the surcharge of the pickup time and NO surge — the
    // surge is evaluated at execution ("priced at ride time").
    boolean scheduled = request.scheduledAt() != null;
    BigDecimal surcharge =
        scheduled
            ? ridePricing.surchargePercentAt(region, request.scheduledAt())
            : ridePricing.surchargeNow(region);
    RidePricing.PickupSurge pickupSurge =
        scheduled
            ? new RidePricing.PickupSurge(SurgeCalculator.NO_SURGE, null)
            : ridePricing.surgeAt(region, request.pickup());
    BigDecimal surge = pickupSurge.multiplier();
    List<ServiceTypeEstimateDto> options =
        serviceTypeRepository.findByRegionIdAndEnabledTrueOrderByNameEnAsc(region.getId()).stream()
            .map(
                serviceType ->
                    new ServiceTypeEstimateDto(
                        serviceType.getId(),
                        serviceType.getNameEn(),
                        serviceType.getNameAr(),
                        ridePricing.estimate(
                            serviceType, region.getCurrency(), route, surcharge, surge)))
            .toList();
    PickupDistanceMode mode = preferences(userId).getPickupDistanceMode();
    return new EstimateResponseDto(
        region.getId(),
        region.getCurrency(),
        surge,
        pickupSurge.active(),
        pickupSurge.zoneName(),
        surcharge,
        new RouteSummaryDto(
            route.distanceMeters(),
            route.durationSeconds(),
            route.approximate(),
            new GeoJsonLineStringDto("LineString", route.geometry())),
        options,
        mode,
        mode == PickupDistanceMode.ACCEPT_DISTANT_FEE
            ? new PickupFeeRuleDto(region.getPickupFeeThresholdKm(), region.getPickupFeePerKm())
            : null,
        scheduled);
  }

  @Override
  public RideDto book(UUID userId, BookRideRequestDto request) {
    Ride ride = createRide(userId, request, null);
    rideEvents.stateChanged(ride);
    return rideAssembler.view(ride, Audience.RIDER);
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<RideDto> active(UUID userId) {
    rideAccess.requireRider(userId);
    // M12: a member of a live shared ride has that ride as their active ride; a shared ride is
    // never the creator's by its ride row alone (review H3).
    return rideRepository
        .findOwnActive(userId, RideRepository.ACTIVE_STATES)
        .or(
            () ->
                sharedRideMemberRepository
                    .findLiveRideOfMember(userId)
                    .flatMap(rideRepository::findById))
        .map(ride -> rideAssembler.view(ride, Audience.RIDER, userId));
  }

  @Override
  @Transactional(readOnly = true)
  public RideDto get(UUID userId, UUID rideId) {
    rideAccess.requireRider(userId);
    return rideAssembler.view(visible(userId, rideId), Audience.RIDER, userId);
  }

  @Override
  @Transactional(readOnly = true)
  public RideSummaryPageDto history(UUID userId, int page, int size) {
    rideAccess.requireRider(userId);
    return rideLifecycle.historyPage(
        rideRepository.findRiderHistory(userId, PageRequest.of(page, size)),
        RideParty.RIDER,
        userId);
  }

  @Override
  @Transactional(readOnly = true)
  public CancellationQuoteDto cancellationQuote(UUID userId, UUID rideId) {
    rideAccess.requireRider(userId);
    Ride ride = owned(userId, rideId);
    requireRiderCancellable(ride);
    Instant now = clock.instant();
    BigDecimal fee = rideLifecycle.riderCancellationFee(ride, now);
    Instant graceEndsAt =
        ride.getCancellationGraceEndsAt() != null && now.isBefore(ride.getCancellationGraceEndsAt())
            ? ride.getCancellationGraceEndsAt()
            : null;
    return new CancellationQuoteDto(
        fee == null, fee, fee == null ? null : ride.getCurrency(), graceEndsAt);
  }

  @Override
  public RideDto cancel(UUID userId, UUID rideId, RiderCancelRequestDto request) {
    rideAccess.requireRider(userId);
    if (!RIDER_REASONS.contains(request.reason())) {
      throw new InvalidRequestException("This cancellation reason is not available to riders");
    }
    requireNoteForOther(request.reason(), request.note());
    Ride ride = lockOwned(userId, rideId);
    requireRiderCancellable(ride);
    if (ride.getKind() == RideKind.SHARED) {
      // M12: a shared ride is left / cancelled through scheduled-shared-v1 (per member).
      throw RideLifecycle.illegalState(ride);
    }
    Instant now = clock.instant();
    UUID driverUserId = ride.getDriverUserId();
    ride.setCancellationFee(rideLifecycle.riderCancellationFee(ride, now));
    rideLifecycle.withdrawOpenOffer(ride, now);
    ride.setState(RideState.CANCELLED_BY_RIDER);
    ride.setCancelledAt(now);
    ride.setCancellationReason(request.reason());
    ride.setCancellationNote(blankToNull(request.note()));
    ride = rideRepository.saveAndFlush(ride);
    // CHAT-01 owner ruling: a cancellation after acceptance keeps the chat window for the same
    // 24 h as a completion (no-op before acceptance — no thread exists yet).
    chatService.closeThread(ride.getId(), now);
    // RIDE-07 collection (M8): wallet-method rides are debited now; any shortfall (and the whole
    // fee on cash-method rides) is carried as a pending due.
    if (ride.getCancellationFee() != null) {
      rideMoneyService.collectCancellationFee(ride);
    }
    rideEvents.stateChanged(ride);
    if (driverUserId != null) {
      rideEvents.push(
          driverUserId,
          NotificationEvent.RIDE_CANCELLED_BY_RIDER,
          Map.of("rideId", ride.getId().toString()));
      rideLifecycle.releaseDriver(driverUserId, now);
    } else if (ride.getKind() == RideKind.SCHEDULED) {
      // S5 (scheduled-shared-v1): a scheduled ride cancels free; its claiming driver is told.
      UUID cancelledRideId = ride.getId();
      scheduledRideRepository
          .findById(cancelledRideId)
          .filter(scheduled -> scheduled.isClaimed() && !scheduled.isExecuted())
          .ifPresent(
              scheduled ->
                  rideEvents.push(
                      scheduled.getClaimedDriverUserId(),
                      NotificationEvent.RIDE_CANCELLED_BY_RIDER,
                      Map.of("rideId", cancelledRideId.toString())));
    }
    return rideAssembler.view(ride, Audience.RIDER);
  }

  @Override
  public RideDto changeRoute(UUID userId, UUID rideId, RouteChangeRequestDto request) {
    rideAccess.requireRider(userId);
    Ride ride = lockOwned(userId, rideId);
    if (!ride.isAssigned() || ride.getKind() == RideKind.SHARED) {
      // M12: a shared ride has one destination, no route changes.
      throw RideLifecycle.illegalState(ride);
    }
    Region region = regionRepository.findById(ride.getRegionId()).orElseThrow();
    ridePricing.checkRoute(region, request.destination(), request.stops());
    PlaceDto pickup = rideAssembler.place(ride.getPickup(), ride.getPickupLabel());
    RouteDto route = ridePricing.route(pickup, request.stops(), request.destination());
    ServiceType serviceType = serviceTypeRepository.findById(ride.getServiceTypeId()).orElseThrow();
    // The locked surcharge and surge stay; only the estimate moves (metering is unaffected).
    EstimateDto estimate =
        ridePricing.estimate(
            serviceType,
            ride.getCurrency(),
            route,
            ride.getSurchargePercent(),
            ride.getSurgeMultiplier());
    ride.setDestination(GeoPoints.point(request.destination().lat(), request.destination().lng()));
    ride.setDestinationLabel(request.destination().label());
    ride.setStops(rideAssembler.stopMaps(request.stops()));
    applyEstimate(ride, estimate);
    ride = rideRepository.saveAndFlush(ride);
    rideEvents.updated(ride, "route_changed");
    return rideAssembler.view(ride, Audience.RIDER);
  }

  @Override
  public RideDto retry(UUID userId, UUID rideId, BigDecimal expectedSurgeMultiplier) {
    rideAccess.requireRider(userId);
    Ride previous = owned(userId, rideId);
    // Review W5 (owner ruling 2026-10-17): a shared ride ends at no_driver_found — no retry.
    if (previous.getState() != RideState.NO_DRIVER_FOUND || previous.getKind() == RideKind.SHARED) {
      throw RideLifecycle.illegalState(previous);
    }
    BookRideRequestDto request =
        new BookRideRequestDto(
            rideAssembler.place(previous.getPickup(), previous.getPickupLabel()),
            rideAssembler.place(previous.getDestination(), previous.getDestinationLabel()),
            rideAssembler.stops(previous.getStops()),
            previous.getServiceTypeId(),
            previous.getPaymentMethod(),
            // PRC-02: never lock an unseen surge — the rider saw the old lock, or confirmed anew.
            expectedSurgeMultiplier != null
                ? expectedSurgeMultiplier
                : previous.getSurgeMultiplier());
    Ride ride = createRide(userId, request, previous.getId());
    rideEvents.stateChanged(ride);
    return rideAssembler.view(ride, Audience.RIDER);
  }

  @Override
  @Transactional(readOnly = true)
  public ReceiptDto receipt(UUID userId, UUID rideId) {
    rideAccess.requireRider(userId);
    Ride ride = visible(userId, rideId);
    if (ride.getState() != RideState.COMPLETED) {
      throw new ResourceNotFoundException("No receipt for this ride");
    }
    // RIDE-P4: a member's own receipt — their share's money, their payment method.
    SharedRideMember member = null;
    if (ride.getKind() == RideKind.SHARED) {
      member =
          sharedRideMemberRepository
              .findFirstByRideIdAndRiderUserIdAndStatusIn(
                  rideId, userId, List.of(SharedMemberStatus.COMPLETED))
              .orElseThrow(() -> new ResourceNotFoundException("No receipt for this ride"));
    }
    ServiceType serviceType = serviceTypeRepository.findById(ride.getServiceTypeId()).orElseThrow();
    FinalFareDto fare =
        fareRepository.findById(ride.getId()).map(rideAssembler::finalFare).orElseThrow();
    RideMoneyService.RideMoney money =
        member != null
            ? rideMoneyService.memberMoney(ride, member)
            : rideMoneyService.rideMoney(ride, fare.components().total());
    return new ReceiptDto(
        ride.getId(),
        ride.getRegionId(),
        serviceType.getNameEn(),
        serviceType.getNameAr(),
        rideAssembler.place(ride.getPickup(), ride.getPickupLabel()),
        rideAssembler.place(ride.getDestination(), ride.getDestinationLabel()),
        rideAssembler.stops(ride.getStops()),
        rideAssembler.timeline(ride),
        fare,
        member != null ? member.getPaymentMethod() : ride.getPaymentMethod(),
        ride.getPaymentStatus(),
        money.walletApplied(),
        money.cashDue(),
        money.carriedDues(),
        money.tip(),
        rideAssembler.driverSummary(ride.getDriverUserId(), ride.getVehicleId()),
        rideLifecycle.inRideLine(ride.getId()));
  }

  /**
   * Validates, prices and stores a new {@code requested} ride (booking and retry) with the pickup
   * zone's current surge LOCKED on it (PRC-02); a retry is re-priced at the moment (it is a new
   * request, RIDE-08) but expects the surge the rider saw, like a booking.
   */
  private Ride createRide(UUID userId, BookRideRequestDto request, UUID retryOfRideId) {
    rideAccess.requireActiveRider(userId);
    Region region = ridePricing.regionOf(request.pickup());
    ridePricing.checkRoute(region, request.destination(), request.stops());
    ServiceType serviceType =
        serviceTypeRepository
            .findById(request.serviceTypeId())
            .filter(type -> type.getRegionId().equals(region.getId()) && type.isEnabled())
            .orElseThrow(
                () ->
                    new BusinessRuleViolationException(
                            "This service type is not available in the pickup's operating area")
                        .withCode("service_type_unavailable"));
    // Review H2/W12 (owner ruling 2026-10-17): a gathering membership counts as busy; the check
    // runs under the rider's own lock.
    if (riderBusy(userId)) {
      throw activeRideExists();
    }
    BigDecimal surcharge = ridePricing.surchargeNow(region);
    BigDecimal surge = ridePricing.surgeAt(region, request.pickup()).multiplier();
    if (request.expectedSurgeMultiplier() != null
        && request.expectedSurgeMultiplier().compareTo(surge) != 0) {
      // PRC-02: never lock a multiplier the rider was not shown — re-confirm at the new value.
      throw new ConflictException("The surge multiplier has changed; please review the new price")
          .withCode("surge_changed")
          .withDetail("surgeMultiplier", surge);
    }
    RouteDto route = ridePricing.route(request.pickup(), request.stops(), request.destination());
    EstimateDto estimate =
        ridePricing.estimate(serviceType, region.getCurrency(), route, surcharge, surge);
    Ride ride =
        Ride.builder()
            .riderUserId(userId)
            .regionId(region.getId())
            .serviceTypeId(serviceType.getId())
            .pickup(GeoPoints.point(request.pickup().lat(), request.pickup().lng()))
            .pickupLabel(request.pickup().label())
            .destination(GeoPoints.point(request.destination().lat(), request.destination().lng()))
            .destinationLabel(request.destination().label())
            .stops(rideAssembler.stopMaps(request.stops()))
            .paymentMethod(request.paymentMethod())
            .pickupDistanceMode(preferences(userId).getPickupDistanceMode())
            .currency(region.getCurrency())
            .surgeMultiplier(surge)
            .surchargePercent(surcharge)
            .retryOfRideId(retryOfRideId)
            .requestedAt(clock.instant())
            .build();
    applyEstimate(ride, estimate);
    try {
      return rideRepository.saveAndFlush(ride);
    } catch (DataIntegrityViolationException ex) {
      // A concurrent booking won the one-active-ride index (UC-R-04 E4).
      throw activeRideExists();
    }
  }

  /**
   * Locks the rider's ride-taking steps and says whether they already hold a live own ride or an
   * open (gathering / live) shared membership.
   */
  private boolean riderBusy(UUID userId) {
    rideRepository.lockRider(userId);
    return rideRepository.findOwnActive(userId, RideRepository.ACTIVE_STATES).isPresent()
        || sharedRideMemberRepository.existsOpenMembership(userId);
  }

  private void applyEstimate(Ride ride, EstimateDto estimate) {
    ride.setEstimateTotal(estimate.components().total());
    ride.setEstimateDistanceM((int) estimate.distanceMeters());
    ride.setEstimateDurationS((int) estimate.durationSeconds());
    ride.setEstimateApproximate(estimate.approximate());
    ride.setEstimateComponents(rideAssembler.componentsMap(estimate.components()));
  }

  /** Locks FIRST, then checks ownership on the locked (fresh) row. */
  private Ride lockOwned(UUID userId, UUID rideId) {
    Ride ride = rideLifecycle.lock(rideId);
    if (!ride.getRiderUserId().equals(userId)) {
      throw new ResourceNotFoundException(NOT_FOUND);
    }
    return ride;
  }

  /** The rider's own ride, or a shared ride they are (or were, after dispatch) a member of. */
  private Ride visible(UUID userId, UUID rideId) {
    return rideRepository
        .findById(rideId)
        .filter(
            ride ->
                ride.getRiderUserId().equals(userId)
                    || (ride.getKind() == RideKind.SHARED
                        && sharedRideMemberRepository
                            .findFirstByRideIdAndRiderUserIdOrderByJoinedAtDesc(rideId, userId)
                            .filter(member -> member.getStatus() != SharedMemberStatus.LEFT)
                            .isPresent()))
        .orElseThrow(() -> new ResourceNotFoundException(NOT_FOUND));
  }

  private Ride owned(UUID userId, UUID rideId) {
    return rideRepository
        .findById(rideId)
        .filter(ride -> ride.getRiderUserId().equals(userId))
        .orElseThrow(() -> new ResourceNotFoundException(NOT_FOUND));
  }

  private RiderPreference preferences(UUID userId) {
    return riderPreferenceRepository
        .findById(userId)
        .orElseGet(() -> RiderPreference.defaults(userId));
  }

  private static void requireRiderCancellable(Ride ride) {
    switch (ride.getState()) {
      case SCHEDULED, REQUESTED, OFFERING, ACCEPTED, DRIVER_ARRIVED -> {
        // Transition 10 (and S5 from scheduled, always free) is legal from these states.
      }
      default -> throw RideLifecycle.illegalState(ride);
    }
  }

  static void requireNoteForOther(CancellationReason reason, String note) {
    if (reason == CancellationReason.OTHER && (note == null || note.isBlank())) {
      throw new InvalidRequestException("Please describe the reason");
    }
  }

  static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }

  private static ConflictException activeRideExists() {
    return (ConflictException)
        new ConflictException("You already have an active ride").withCode("active_ride_exists");
  }
}
