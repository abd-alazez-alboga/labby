package com.labby.backend.service;

import com.labby.backend.config.RideProperties;
import com.labby.backend.config.TrackingProperties;
import com.labby.backend.dto.CarriedDueDto;
import com.labby.backend.dto.DriverCancelRequestDto;
import com.labby.backend.dto.FareComponentsDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RideOfferDto;
import com.labby.backend.dto.RideSummaryPageDto;
import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.OfferResponse;
import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RideState;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RideOffer;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.model.User;
import com.labby.backend.repository.FareRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideOfferRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RideTraceRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.service.RideAssembler.Audience;
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
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Driver actions. Each locks the ride row before reading its offer or state, so of two racing
 * requests (accept vs rider cancel, double accept, accept vs timeout) exactly one wins and the
 * other gets 409. Another driver's ride or offer is a plain 404.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverRideServiceImpl implements DriverRideService {

  /** The reasons a driver may give (rides-v1 DriverCancelRequest). */
  static final Set<CancellationReason> DRIVER_REASONS =
      Set.of(
          CancellationReason.RIDER_NO_SHOW,
          CancellationReason.VEHICLE_ISSUE,
          CancellationReason.UNSAFE_PICKUP,
          CancellationReason.OTHER);

  private static final String NOT_FOUND = "Ride not found";

  private final RideAccess rideAccess;
  private final RideAssembler rideAssembler;
  private final ChatService chatService;
  private final RideEvents rideEvents;
  private final RideLifecycle rideLifecycle;
  private final FareCalculator fareCalculator;
  private final RideExtrasCalculator rideExtrasCalculator;
  private final RideMoneyService rideMoneyService;
  private final SharedRideService sharedRideService;
  private final RideRepository rideRepository;
  private final RegionRepository regionRepository;
  private final RideOfferRepository rideOfferRepository;
  private final RideTraceRepository rideTraceRepository;
  private final FareRepository fareRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final UserRepository userRepository;
  private final RideProperties rideProperties;
  private final TrackingProperties trackingProperties;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public Optional<RideOfferDto> openOffer(UUID userId) {
    rideAccess.requireDriver(userId);
    Instant now = clock.instant();
    return rideOfferRepository
        .findFirstByDriverUserIdAndResponseIsNull(userId)
        .filter(offer -> now.isBefore(offer.getExpiresAt()))
        .map(
            offer ->
                rideAssembler.offer(
                    rideRepository.findById(offer.getRideId()).orElseThrow(), offer));
  }

  @Override
  public RideDto accept(UUID userId, UUID offerId) {
    rideAccess.requireDriver(userId);
    Ride ride = lockOffersRide(userId, offerId);
    RideOffer offer = rideOfferRepository.findById(offerId).orElseThrow();
    Instant now = clock.instant();
    if (ride.getState() != RideState.OFFERING || !RideLifecycle.answerable(offer, now)) {
      throw offerClosed();
    }
    offer.setResponse(OfferResponse.ACCEPTED);
    offer.setRespondedAt(now);
    rideOfferRepository.save(offer);
    ride.setState(RideState.ACCEPTED);
    ride.setAcceptedAt(now);
    ride.setDriverUserId(userId);
    ride.setVehicleId(offer.getVehicleId());
    ride.setCancellationGraceEndsAt(rideLifecycle.cancellationGraceEnd(ride.getRegionId(), now));
    ride.setEtaSeconds(offer.getPickupEtaS());
    ride.setEtaRefreshedAt(now);
    ride = rideRepository.saveAndFlush(ride);
    // CHAT-01: the ride's chat thread opens at acceptance (before that there is no counterpart).
    chatService.openThread(ride, now);
    rideEvents.stateChanged(ride);
    rideEvents.pushRiders(
        ride,
        NotificationEvent.RIDE_ACCEPTED,
        Map.of("rideId", ride.getId().toString(), "driverName", driverFirstName(userId)));
    return rideAssembler.view(ride, Audience.DRIVER);
  }

  @Override
  public void decline(UUID userId, UUID offerId) {
    rideAccess.requireDriver(userId);
    Ride ride = lockOffersRide(userId, offerId);
    RideOffer offer = rideOfferRepository.findById(offerId).orElseThrow();
    Instant now = clock.instant();
    if (ride.getState() != RideState.OFFERING || !RideLifecycle.answerable(offer, now)) {
      throw offerClosed();
    }
    offer.setResponse(OfferResponse.DECLINED);
    offer.setRespondedAt(now);
    rideOfferRepository.saveAndFlush(offer);
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<RideDto> active(UUID userId) {
    rideAccess.requireDriver(userId);
    return rideRepository.findDriverCurrent(userId, RideRepository.ASSIGNED_STATES).stream()
        .findFirst()
        .map(ride -> rideAssembler.view(ride, Audience.DRIVER));
  }

  @Override
  @Transactional(readOnly = true)
  public RideDto get(UUID userId, UUID rideId) {
    rideAccess.requireDriver(userId);
    return rideAssembler.view(owned(userId, rideId), Audience.DRIVER);
  }

  @Override
  @Transactional(readOnly = true)
  public RideSummaryPageDto history(UUID userId, int page, int size) {
    rideAccess.requireDriver(userId);
    return rideLifecycle.historyPage(
        rideRepository.findByDriverUserIdOrderByRequestedAtDesc(userId, PageRequest.of(page, size)),
        RideParty.DRIVER,
        userId);
  }

  @Override
  public RideDto arrive(UUID userId, UUID rideId) {
    Ride ride = lockOwned(userId, rideId);
    if (ride.getState() != RideState.ACCEPTED) {
      throw RideLifecycle.illegalState(ride);
    }
    Instant now = clock.instant();
    int geofence = rideProperties.arriveGeofenceMeters();
    Optional<Double> distance =
        rideRepository.driverDistanceToPickup(
            rideId, now.minusSeconds(trackingProperties.staleAfterSeconds()));
    if (distance.isEmpty()) {
      throw new BusinessRuleViolationException(
              "We don't have your current location yet; check your GPS and try again")
          .withCode("no_position")
          .withDetail("distanceMeters", null)
          .withDetail("geofenceMeters", geofence);
    }
    if (distance.get() > geofence) {
      long meters = Math.round(distance.get());
      throw new BusinessRuleViolationException(
              "You are %d m from the pickup point; get within %d m to mark arrived"
                  .formatted(meters, geofence))
          .withCode("outside_geofence")
          .withDetail("distanceMeters", meters)
          .withDetail("geofenceMeters", geofence);
    }
    ride.setState(RideState.DRIVER_ARRIVED);
    ride.setDriverArrivedAt(now);
    ride = rideRepository.saveAndFlush(ride);
    rideEvents.stateChanged(ride);
    rideEvents.pushRiders(
        ride,
        NotificationEvent.RIDE_DRIVER_ARRIVED,
        Map.of("rideId", ride.getId().toString(), "driverName", driverFirstName(userId)));
    return rideAssembler.view(ride, Audience.DRIVER);
  }

  @Override
  public RideDto start(UUID userId, UUID rideId) {
    Ride ride = lockOwned(userId, rideId);
    if (ride.getState() != RideState.DRIVER_ARRIVED) {
      throw RideLifecycle.illegalState(ride);
    }
    ride.setState(RideState.IN_PROGRESS);
    ride.setStartedAt(clock.instant());
    // The next ETA refresh targets the destination instead of the pickup.
    ride.setEtaSeconds(null);
    ride.setEtaRefreshedAt(null);
    ride = rideRepository.saveAndFlush(ride);
    rideEvents.stateChanged(ride);
    rideEvents.pushRiders(
        ride, NotificationEvent.RIDE_STARTED, Map.of("rideId", ride.getId().toString()));
    return rideAssembler.view(ride, Audience.DRIVER);
  }

  @Override
  public RideDto complete(UUID userId, UUID rideId) {
    Ride ride = lockOwned(userId, rideId);
    if (ride.getState() != RideState.IN_PROGRESS) {
      throw RideLifecycle.illegalState(ride);
    }
    Instant now = clock.instant();
    long distanceMeters = Math.round(rideTraceRepository.meteredDistanceMeters(rideId));
    long durationSeconds = Math.max(0, Duration.between(ride.getStartedAt(), now).toSeconds());
    ServiceType serviceType = serviceTypeRepository.findById(ride.getServiceTypeId()).orElseThrow();
    Region region = regionRepository.findById(ride.getRegionId()).orElseThrow();
    FareComponentsDto components =
        fareCalculator.price(
            serviceType,
            ride.getCurrency(),
            distanceMeters,
            durationSeconds,
            ride.getSurchargePercent(),
            ride.getSurgeMultiplier(),
            rideExtrasCalculator.waitFare(ride, region),
            rideExtrasCalculator.pickupFee(ride, region));
    Fare fare =
        fareRepository.saveAndFlush(
            Fare.builder()
                .rideId(ride.getId())
                .currency(components.currency())
                .distanceM((int) distanceMeters)
                .durationS((int) durationSeconds)
                .baseFare(components.baseFare())
                .distanceFare(components.distanceFare())
                .timeFare(components.timeFare())
                .surchargePercent(components.surchargePercent())
                .surchargeAmount(components.surchargeAmount())
                .surgeMultiplier(components.surgeMultiplier())
                .surgeAmount(components.surgeAmount())
                .waitFare(components.waitFare())
                .pickupFee(components.pickupFee())
                .minimumFareAdjustment(components.minimumFareAdjustment())
                .discount(components.discount())
                .total(components.total())
                .build());
    ride.setState(RideState.COMPLETED);
    ride.setCompletedAt(now);
    // CHAT-01: the chat window survives the completion by 24 h.
    chatService.closeThread(ride.getId(), now);
    if (ride.getKind() == RideKind.SHARED) {
      // RIDE-P4: the fare is split per seat over the boarded members; each pays their own share
      // by their own method, with their own dues carried (money-v1 per member).
      ride.setPaymentStatus(PaymentStatus.SPLIT);
      List<SharedRideMember> members = sharedRideService.settleSplit(ride, fare);
      rideMoneyService.applySharedAtCompletion(ride, members);
      ride = rideRepository.saveAndFlush(ride);
      rideEvents.stateChanged(ride);
      for (SharedRideMember member : members) {
        rideEvents.push(
            member.getRiderUserId(),
            NotificationEvent.RIDE_COMPLETED,
            completedParams(
                ride,
                member.getShareAmount(),
                member.getPaymentMethod(),
                rideMoneyService.memberMoney(ride, member)));
      }
      rideLifecycle.releaseDriver(userId, now);
      return rideAssembler.view(ride, Audience.DRIVER);
    }
    ride.setPaymentStatus(PaymentStatus.PENDING);
    // PAY-02 + COM-01 (M8): wallet application (may flip the status to paid_wallet), the fare
    // posting at the weekly rate, and every pending rider due carried along — one transaction.
    rideMoneyService.applyAtCompletion(ride, fare);
    ride = rideRepository.saveAndFlush(ride);
    rideEvents.stateChanged(ride);
    rideEvents.push(
        ride.getRiderUserId(),
        NotificationEvent.RIDE_COMPLETED,
        completedParams(
            ride,
            components.total(),
            ride.getPaymentMethod(),
            rideMoneyService.rideMoney(ride, fare.getTotal())));
    rideLifecycle.releaseDriver(userId, now);
    return rideAssembler.view(ride, Audience.DRIVER);
  }

  /** The {@code ride.completed} push params of one payer (the rider, or a shared-ride member). */
  private static Map<String, Object> completedParams(
      Ride ride, BigDecimal total, PaymentMethod method, RideMoneyService.RideMoney money) {
    Map<String, Object> params = new HashMap<>();
    params.put("rideId", ride.getId().toString());
    params.put("total", total.toPlainString());
    params.put("currency", ride.getCurrency());
    params.put("method", method.getValue());
    if (money.walletApplied() != null) {
      params.put("walletApplied", money.walletApplied().toPlainString());
    }
    if (money.cashDue() != null) {
      params.put("cashDue", money.cashDue().toPlainString());
    }
    // M8 re-audit R-W1: the carried cancellation fees, itemized by how they are paid.
    putCarried(params, "carriedWallet", money, CarriedDueDto.METHOD_WALLET);
    putCarried(params, "carriedCash", money, CarriedDueDto.METHOD_CASH);
    return params;
  }

  @Override
  public RideDto confirmCash(UUID userId, UUID rideId) {
    // PAY-02: the cash of the fare's remainder and of any carried cash due arrived.
    return settle(userId, rideId, null, null, "payment_confirmed");
  }

  @Override
  public RideDto markUnpaid(UUID userId, UUID rideId, String note) {
    return settle(
        userId,
        rideId,
        PaymentStatus.UNPAID,
        RiderRideServiceImpl.blankToNull(note),
        "payment_unpaid");
  }

  @Override
  public RideDto cancel(UUID userId, UUID rideId, DriverCancelRequestDto request) {
    if (!DRIVER_REASONS.contains(request.reason())) {
      throw new InvalidRequestException("This cancellation reason is not available to drivers");
    }
    RiderRideServiceImpl.requireNoteForOther(request.reason(), request.note());
    Ride ride = lockOwned(userId, rideId);
    if (ride.getState() != RideState.ACCEPTED && ride.getState() != RideState.DRIVER_ARRIVED) {
      throw RideLifecycle.illegalState(ride);
    }
    Instant now = clock.instant();
    boolean noShow = request.reason() == CancellationReason.RIDER_NO_SHOW;
    if (noShow && ride.getKind() == RideKind.SHARED) {
      // UC-D-13 E1: on a shared ride absent parties are marked one by one (member no-show).
      throw new InvalidRequestException("Mark the absent members instead")
          .withCode("use_member_no_show");
    }
    if (noShow) {
      Instant waitedUntil =
          ride.getDriverArrivedAt() == null
              ? null
              : ride.getDriverArrivedAt()
                  .plusSeconds(60L * rideAssembler.waitGraceMinutes(ride.getRegionId()));
      if (waitedUntil == null || now.isBefore(waitedUntil)) {
        throw new BusinessRuleViolationException(
                "You can cancel for a no-show once the rider's wait time is over")
            .withCode("no_show_too_early")
            .withDetail("availableAt", waitedUntil == null ? null : waitedUntil.toString());
      }
      ride.setCancellationFee(rideLifecycle.regionFee(ride.getRegionId()));
    }
    ride.setState(RideState.CANCELLED_BY_DRIVER);
    ride.setCancelledAt(now);
    ride.setCancellationReason(request.reason());
    ride.setCancellationNote(RiderRideServiceImpl.blankToNull(request.note()));
    ride = rideRepository.saveAndFlush(ride);
    // CHAT-01 owner ruling: a post-acceptance cancellation keeps the same 24 h window; the
    // redispatched ride gets its own thread at its own acceptance.
    chatService.closeThread(ride.getId(), now);
    // RIDE-07 collection (M8): a no-show fee is collected like a rider-cancel fee.
    if (ride.getCancellationFee() != null) {
      rideMoneyService.collectCancellationFee(ride);
    }
    // The new linked ride is saved BEFORE the cancelled ride is announced, so the rider's
    // ride.state frame already carries redispatchedAsRideId (rides-v1 rider view).
    Ride redispatched = noShow ? null : redispatch(ride, now);
    if (redispatched != null && ride.getKind() == RideKind.SHARED) {
      // M12: the group moves to the new ride with its seats and parties.
      sharedRideService.copyForRedispatch(ride, redispatched, now);
    }
    rideEvents.stateChanged(ride);
    Map<String, Object> pushParams = new HashMap<>();
    pushParams.put("noShow", String.valueOf(noShow));
    if (redispatched == null) {
      pushParams.put("rideId", ride.getId().toString());
      if (ride.getCancellationFee() != null) {
        pushParams.put("fee", ride.getCancellationFee().toPlainString());
        pushParams.put("currency", ride.getCurrency());
      }
    } else {
      rideEvents.stateChanged(redispatched);
      pushParams.put("rideId", redispatched.getId().toString());
    }
    rideEvents.pushRiders(ride, NotificationEvent.RIDE_CANCELLED_BY_DRIVER, pushParams);
    rideLifecycle.releaseDriver(userId, now);
    return rideAssembler.view(ride, Audience.DRIVER);
  }

  /**
   * The owner decision of 2026-10-07: a new linked ride with the same inputs and locked pricing.
   */
  private Ride redispatch(Ride cancelled, Instant now) {
    return rideRepository.saveAndFlush(
        Ride.builder()
            .riderUserId(cancelled.getRiderUserId())
            .regionId(cancelled.getRegionId())
            .serviceTypeId(cancelled.getServiceTypeId())
            .kind(cancelled.getKind())
            .pickup(cancelled.getPickup())
            .pickupLabel(cancelled.getPickupLabel())
            .destination(cancelled.getDestination())
            .destinationLabel(cancelled.getDestinationLabel())
            .stops(new ArrayList<>(cancelled.getStops()))
            .paymentMethod(cancelled.getPaymentMethod())
            .pickupDistanceMode(cancelled.getPickupDistanceMode())
            .currency(cancelled.getCurrency())
            .surgeMultiplier(cancelled.getSurgeMultiplier())
            .surchargePercent(cancelled.getSurchargePercent())
            .estimateTotal(cancelled.getEstimateTotal())
            .estimateDistanceM(cancelled.getEstimateDistanceM())
            .estimateDurationS(cancelled.getEstimateDurationS())
            .estimateApproximate(cancelled.isEstimateApproximate())
            .estimateComponents(new HashMap<>(cancelled.getEstimateComponents()))
            .redispatchOfRideId(cancelled.getId())
            .requestedAt(now)
            .build());
  }

  /**
   * {@code status} null = a cash confirmation ({@code paid_mixed} when the wallet paid part of the
   * fare, else {@code paid_cash}); otherwise {@code unpaid}.
   */
  private RideDto settle(
      UUID userId, UUID rideId, PaymentStatus status, String note, String reason) {
    Ride ride = lockOwned(userId, rideId);
    if (ride.getState() != RideState.COMPLETED
        || ride.getPaymentStatus() != PaymentStatus.PENDING) {
      throw (ConflictException)
          new ConflictException("The payment of this ride is already settled or not due")
              .withCode("payment_not_pending");
    }
    if (status == null) {
      // The cash arrived: the dues this ride carries in cash are collected now (M8 audit H3).
      status = rideMoneyService.confirmCash(ride);
    } else {
      // Nothing was paid: the carried cash dues go back to pending, no money moved.
      rideMoneyService.releaseCarriedDues(ride);
    }
    ride.setPaymentStatus(status);
    ride.setPaymentConfirmedAt(clock.instant());
    ride.setPaymentNote(note);
    ride = rideRepository.saveAndFlush(ride);
    rideEvents.updated(ride, reason);
    return rideAssembler.view(ride, Audience.DRIVER);
  }

  private Ride lockOffersRide(UUID userId, UUID offerId) {
    UUID rideId =
        rideOfferRepository
            .findRideIdOfDriverOffer(offerId, userId)
            .orElseThrow(() -> new ResourceNotFoundException("Offer not found"));
    return rideLifecycle.lock(rideId);
  }

  /** Locks FIRST, then checks ownership on the locked (fresh) row. */
  private Ride lockOwned(UUID userId, UUID rideId) {
    rideAccess.requireDriver(userId);
    Ride ride = rideLifecycle.lock(rideId);
    if (!userId.equals(ride.getDriverUserId())) {
      throw new ResourceNotFoundException(NOT_FOUND);
    }
    return ride;
  }

  private Ride owned(UUID userId, UUID rideId) {
    return rideRepository
        .findById(rideId)
        .filter(ride -> userId.equals(ride.getDriverUserId()))
        .orElseThrow(() -> new ResourceNotFoundException(NOT_FOUND));
  }

  private String driverFirstName(UUID userId) {
    return userRepository
        .findById(userId)
        .map(User::getName)
        .map(RideAssembler::firstName)
        .orElse("");
  }

  /** Puts the total of the ride's carried dues paid by {@code method}, when there are any. */
  private static void putCarried(
      Map<String, Object> params, String key, RideMoneyService.RideMoney money, String method) {
    BigDecimal total =
        money.carriedDues().stream()
            .filter(due -> method.equals(due.method()))
            .map(CarriedDueDto::amount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    if (total.signum() > 0) {
      params.put(key, total.toPlainString());
    }
  }

  private static ConflictException offerClosed() {
    return (ConflictException)
        new ConflictException("This offer is no longer available").withCode("offer_closed");
  }
}
