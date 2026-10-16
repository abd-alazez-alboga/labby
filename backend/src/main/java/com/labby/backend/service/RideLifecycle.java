package com.labby.backend.service;

import com.labby.backend.dto.GeoJsonLineStringDto;
import com.labby.backend.dto.MyRatingDto;
import com.labby.backend.dto.RideSummaryDto;
import com.labby.backend.dto.RideSummaryPageDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.OfferResponse;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.enums.TracePhase;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RideOffer;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.User;
import com.labby.backend.repository.DriverProfileRepository;
import com.labby.backend.repository.FareRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideOfferRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RideTraceRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

/**
 * Lifecycle rules shared by the rider and driver sides (rides-v1.yaml): withdrawing the open offer
 * when a ride ends, releasing a driver (a driver suspended while on a ride goes offline once it
 * ends — M6 owner item a), the RIDE-07 rider fee rule, and history rows.
 */
@Component
@RequiredArgsConstructor
public class RideLifecycle {

  /** SRS §9 cancellation grace when the region has none set. */
  static final int DEFAULT_CANCELLATION_GRACE_MIN = 2;

  private final RideRepository rideRepository;
  private final RideOfferRepository rideOfferRepository;
  private final RideTraceRepository rideTraceRepository;
  private final FareRepository fareRepository;
  private final RegionRepository regionRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final DriverProfileRepository driverProfileRepository;
  private final UserRepository userRepository;
  private final RatingService ratingService;
  private final RideAssembler rideAssembler;
  private final RideEvents rideEvents;

  /**
   * Locks a ride for a state change.
   *
   * @param rideId the ride
   * @return the locked ride
   * @throws com.labby.backend.exception.ResourceNotFoundException when unknown
   */
  public Ride lock(UUID rideId) {
    return rideRepository
        .findForUpdate(rideId)
        .orElseThrow(
            () -> new com.labby.backend.exception.ResourceNotFoundException("Ride not found"));
  }

  /**
   * The 409 for a request the ride's state does not allow (rides-v1 transition table).
   *
   * @param ride the ride
   * @return the exception
   */
  public static ConflictException illegalState(Ride ride) {
    return (ConflictException)
        new ConflictException("Not allowed while the ride is " + ride.getState().getValue())
            .withCode("illegal_state")
            .withDetail("state", ride.getState().getValue());
  }

  /**
   * Closes the ride's open offer as {@code withdrawn} (the ride ended; not counted against the
   * driver) and tells its driver.
   *
   * @param ride the ending ride (locked)
   * @param now the moment
   */
  public void withdrawOpenOffer(Ride ride, Instant now) {
    rideOfferRepository
        .findFirstByRideIdAndResponseIsNull(ride.getId())
        .ifPresent(
            offer -> {
              offer.setResponse(OfferResponse.WITHDRAWN);
              offer.setRespondedAt(now);
              rideOfferRepository.save(offer);
              rideEvents.offerWithdrawn(offer, "ride_ended");
            });
  }

  /**
   * After a ride ends for its driver: a driver whose role — or whole account (M11, USR-06) — was
   * suspended meanwhile goes offline (suspension forces offline; mid-ride it waits for the ride to
   * end).
   *
   * @param driverUserId the released driver
   * @param now the moment
   */
  public void releaseDriver(UUID driverUserId, Instant now) {
    boolean suspended =
        roleAssignmentRepository
                .findByUserIdAndRole(driverUserId, Role.DRIVER)
                .map(role -> role.getState() == RoleState.SUSPENDED)
                .orElse(false)
            || userRepository
                .findById(driverUserId)
                .map(user -> user.getState() == AccountState.SUSPENDED)
                .orElse(false);
    if (suspended) {
      driverProfileRepository
          .findByUserId(driverUserId)
          .filter(profile -> profile.isOnline())
          .ifPresent(
              profile -> {
                profile.setOnline(false);
                profile.setOnlineChangedAt(now);
                driverProfileRepository.save(profile);
              });
    }
  }

  /**
   * The fee a rider cancellation recorded now (RIDE-07): free before acceptance and within the
   * grace; afterwards the region's fee (none when the region charges 0).
   *
   * @param ride the ride
   * @param now the moment
   * @return the fee, or null when free
   */
  public BigDecimal riderCancellationFee(Ride ride, Instant now) {
    if (ride.getState() != RideState.ACCEPTED && ride.getState() != RideState.DRIVER_ARRIVED) {
      return null;
    }
    if (ride.getCancellationGraceEndsAt() != null
        && now.isBefore(ride.getCancellationGraceEndsAt())) {
      return null;
    }
    return regionFee(ride.getRegionId());
  }

  /**
   * The region's cancellation fee, or null when it charges nothing.
   *
   * @param regionId the region
   * @return the fee or null
   */
  public BigDecimal regionFee(UUID regionId) {
    BigDecimal fee =
        regionRepository.findById(regionId).map(Region::getCancellationFee).orElse(null);
    return fee == null || fee.signum() <= 0 ? null : fee;
  }

  /**
   * When free cancellation ends for a ride accepted now (accepted + region grace).
   *
   * @param regionId the region
   * @param acceptedAt the acceptance
   * @return the grace end
   */
  public Instant cancellationGraceEnd(UUID regionId, Instant acceptedAt) {
    int minutes =
        regionRepository
            .findById(regionId)
            .map(Region::getCancellationGraceMin)
            .orElse(DEFAULT_CANCELLATION_GRACE_MIN);
    return acceptedAt.plusSeconds(60L * minutes);
  }

  /**
   * History rows for a page of rides, as one side sees them: fare totals from the stored fares, the
   * caller's own rating state and the counterpart's first name (M11) — each batched per page.
   *
   * @param rides the page
   * @param side the caller's side
   * @return the DTO page
   */
  public RideSummaryPageDto historyPage(Page<Ride> rides, RideParty side) {
    Map<UUID, Fare> fares =
        fareRepository
            .findByRideIdIn(rides.getContent().stream().map(Ride::getId).toList())
            .stream()
            .collect(Collectors.toMap(Fare::getRideId, Function.identity()));
    Map<UUID, MyRatingDto> ratings = ratingService.myRatings(rides.getContent(), side);
    Map<UUID, String> names =
        userRepository
            .findAllById(
                rides.getContent().stream()
                    .map(ride -> counterpartOf(ride, side))
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet()))
            .stream()
            .collect(
                Collectors.toMap(User::getId, user -> RideAssembler.firstName(user.getName())));
    return new RideSummaryPageDto(
        rides.getContent().stream()
            .map(
                ride ->
                    summary(
                        ride,
                        fares.get(ride.getId()),
                        ratings.get(ride.getId()),
                        names.get(counterpartOf(ride, side))))
            .toList(),
        rides.getNumber(),
        rides.getSize(),
        rides.getTotalElements());
  }

  /**
   * The in-ride trace as a GeoJSON line (receipt route map, UC-R-07).
   *
   * @param rideId the ride
   * @return the line ([lng, lat])
   */
  public GeoJsonLineStringDto inRideLine(UUID rideId) {
    return new GeoJsonLineStringDto(
        "LineString",
        rideTraceRepository.findByRideIdOrderByRecordedAtAscIdAsc(rideId).stream()
            .filter(point -> point.getPhase() == TracePhase.IN_RIDE)
            .map(point -> new double[] {point.getPosition().getX(), point.getPosition().getY()})
            .toList());
  }

  private static UUID counterpartOf(Ride ride, RideParty side) {
    return side == RideParty.RIDER ? ride.getDriverUserId() : ride.getRiderUserId();
  }

  private RideSummaryDto summary(
      Ride ride, Fare fare, MyRatingDto myRating, String counterpartFirstName) {
    ServiceType serviceType = serviceTypeRepository.findById(ride.getServiceTypeId()).orElseThrow();
    return new RideSummaryDto(
        ride.getId(),
        ride.getState(),
        ride.getRequestedAt(),
        rideAssembler.place(ride.getPickup(), ride.getPickupLabel()),
        rideAssembler.place(ride.getDestination(), ride.getDestinationLabel()),
        serviceType.getNameEn(),
        serviceType.getNameAr(),
        fare == null ? null : fare.getTotal(),
        ride.getCancellationFee(),
        ride.getCurrency(),
        myRating,
        counterpartFirstName);
  }

  /**
   * Whether the offer is still answerable at {@code now}.
   *
   * @param offer the offer
   * @param now the moment
   * @return true when open and not expired
   */
  public static boolean answerable(RideOffer offer, Instant now) {
    return offer.isOpen() && now.isBefore(offer.getExpiresAt());
  }
}
