package com.labby.backend.service;

import com.labby.backend.dto.FileRefDto;
import com.labby.backend.dto.MyRatingDto;
import com.labby.backend.dto.OwnRatingAggregateDto;
import com.labby.backend.dto.PendingRatingDto;
import com.labby.backend.dto.RatingRequestDto;
import com.labby.backend.enums.FlagKind;
import com.labby.backend.enums.MyRatingState;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.Role;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Rating;
import com.labby.backend.model.RatingSnapshot;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.User;
import com.labby.backend.repository.RatingRepository;
import com.labby.backend.repository.RatingSnapshotRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.UserRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Ratings, exposed aggregates and the rating rules (see {@link RatingService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class RatingServiceImpl implements RatingService {

  private static final Duration WINDOW = Duration.ofDays(TrustRules.RATING_WINDOW_DAYS);

  private final RatingRepository ratingRepository;
  private final RatingSnapshotRepository ratingSnapshotRepository;
  private final RideRepository rideRepository;
  private final RegionRepository regionRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final UserRepository userRepository;
  private final OnboardingAssembler onboardingAssembler;
  private final SuspensionService suspensionService;
  private final AccountFlagService accountFlagService;
  private final Clock clock;

  @Override
  public void rate(UUID userId, UUID rideId, RatingRequestDto request) {
    Ride ride =
        rideRepository
            .findById(rideId)
            .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    RideParty side = sideOf(ride, userId);
    if (side == null) {
      throw new ForbiddenException("Not a party to this ride");
    }
    if (ride.getState() != RideState.COMPLETED) {
      throw conflict("Only a completed ride can be rated", "ride_not_completed");
    }
    Instant now = clock.instant();
    if (now.isAfter(ride.getCompletedAt().plus(WINDOW))) {
      throw conflict("The rating window for this ride has closed", "rating_window_closed");
    }
    if (ratingRepository.existsByRideIdAndRaterRole(rideId, side)) {
      throw alreadyRated();
    }
    RideParty ratedRole = side.other();
    UUID ratedUserId =
        ratedRole == RideParty.DRIVER ? ride.getDriverUserId() : ride.getRiderUserId();
    String comment =
        request.comment() == null || request.comment().isBlank() ? null : request.comment();
    try {
      ratingRepository.saveAndFlush(
          Rating.builder()
              .rideId(rideId)
              .raterUserId(userId)
              .raterRole(side)
              .ratedUserId(ratedUserId)
              .ratedRole(ratedRole)
              .score(request.score().shortValue())
              .comment(comment)
              .createdAt(now)
              .build());
    } catch (DataIntegrityViolationException ex) {
      throw alreadyRated(); // a concurrent submission of the same side won the unique constraint
    }
    evaluate(ratedUserId, ratedRole, ride.getRegionId());
  }

  /**
   * RATE-03 + USR-05 on the LIVE lifetime average against the rated ride's region: both need the
   * minimum count and a strictly lower average. Re-run on every stored rating, so a reactivated
   * role is suspended again only by the next rating.
   */
  private void evaluate(UUID userId, RideParty role, UUID regionId) {
    Region region = regionRepository.findById(regionId).orElse(null);
    TrustRules.RatingRule rule =
        TrustRules.ratingRule(region == null ? null : region.getSuspensionThresholds(), role);
    RatingRepository.LiveAggregate aggregate =
        ratingRepository.liveAggregate(userId, role.getValue());
    long count = aggregate.getRatingCount();
    BigDecimal average = aggregate.getAverage();
    if (TrustRules.below(average, count, rule.warnAvgRating(), rule.minRatedRides())) {
      Map<String, Object> details = new LinkedHashMap<>();
      details.put("average", average.setScale(2, RoundingMode.HALF_UP));
      details.put("ratingCount", count);
      details.put("warnAvgRating", rule.warnAvgRating());
      details.put("minRatedRides", rule.minRatedRides());
      details.put("regionId", regionId.toString());
      accountFlagService.open(userId, role, FlagKind.LOW_RATING, details);
    }
    if (TrustRules.below(average, count, rule.minAvgRating(), rule.minRatedRides())) {
      suspensionService.suspendForLowRating(userId, role, rule);
    }
  }

  @Override
  @Transactional(readOnly = true)
  public List<PendingRatingDto> pending(UUID userId, String as) {
    RideParty side = parseSide(as);
    List<Ride> rides =
        rideRepository.findRatingPending(userId, side.getValue(), clock.instant().minus(WINDOW));
    Map<UUID, User> counterparts =
        userRepository
            .findAllById(
                rides.stream()
                    .map(
                        ride ->
                            side == RideParty.RIDER
                                ? ride.getDriverUserId()
                                : ride.getRiderUserId())
                    .collect(Collectors.toSet()))
            .stream()
            .collect(Collectors.toMap(User::getId, Function.identity()));
    List<PendingRatingDto> prompts = new ArrayList<>();
    for (Ride ride : rides) {
      User counterpart =
          counterparts.get(
              side == RideParty.RIDER ? ride.getDriverUserId() : ride.getRiderUserId());
      // Riders see the driver's photo (as on the ride); drivers never see rider photos.
      FileRefDto photo =
          side == RideParty.RIDER && counterpart != null
              ? onboardingAssembler.profilePhoto(counterpart)
              : null;
      prompts.add(
          new PendingRatingDto(
              ride.getId(),
              ride.getCompletedAt(),
              ride.getCompletedAt().plus(WINDOW),
              counterpart == null ? "" : RideAssembler.firstName(counterpart.getName()),
              photo == null ? null : photo.url(),
              ride.getPickupLabel(),
              ride.getDestinationLabel()));
    }
    return prompts;
  }

  @Override
  @Transactional(readOnly = true)
  public List<OwnRatingAggregateDto> ownAggregates(UUID userId) {
    List<OwnRatingAggregateDto> aggregates = new ArrayList<>();
    for (RideParty role : RideParty.values()) {
      Role held = role == RideParty.DRIVER ? Role.DRIVER : Role.RIDER;
      if (roleAssignmentRepository.existsByUserIdAndRole(userId, held)) {
        aggregates.add(ownAggregate(userId, role));
      }
    }
    return aggregates;
  }

  @Override
  @Transactional(readOnly = true)
  public OwnRatingAggregateDto ownAggregate(UUID userId, RideParty role) {
    return ratingSnapshotRepository
        .findById(new RatingSnapshot.Key(userId, role))
        .map(
            snapshot ->
                new OwnRatingAggregateDto(
                    role,
                    TrustRules.exposed(snapshot.getAvgScore(), snapshot.getRatingCount()),
                    snapshot.getRatingCount(),
                    snapshot.getComputedAt()))
        .orElseGet(() -> new OwnRatingAggregateDto(role, null, 0, null));
  }

  @Override
  @Transactional(readOnly = true)
  public BigDecimal exposedAverage(UUID userId, RideParty role) {
    return ratingSnapshotRepository
        .findById(new RatingSnapshot.Key(userId, role))
        .map(snapshot -> TrustRules.exposed(snapshot.getAvgScore(), snapshot.getRatingCount()))
        .orElse(null);
  }

  @Override
  @Transactional(readOnly = true)
  public MyRatingDto myRating(Ride ride, RideParty side) {
    return toMyRating(
        ride, ratingRepository.findByRideIdAndRaterRole(ride.getId(), side).orElse(null));
  }

  @Override
  @Transactional(readOnly = true)
  public Map<UUID, MyRatingDto> myRatings(List<Ride> rides, RideParty side) {
    List<UUID> completed =
        rides.stream()
            .filter(ride -> ride.getState() == RideState.COMPLETED)
            .map(Ride::getId)
            .toList();
    Map<UUID, Rating> given =
        completed.isEmpty()
            ? Map.of()
            : ratingRepository.findByRideIdInAndRaterRole(completed, side).stream()
                .collect(Collectors.toMap(Rating::getRideId, Function.identity()));
    Map<UUID, MyRatingDto> states = new LinkedHashMap<>();
    for (Ride ride : rides) {
      states.put(ride.getId(), toMyRating(ride, given.get(ride.getId())));
    }
    return states;
  }

  /** The state of one ride from the caller's rating on it (null = none). */
  private MyRatingDto toMyRating(Ride ride, Rating rating) {
    if (ride.getState() != RideState.COMPLETED || ride.getCompletedAt() == null) {
      return new MyRatingDto(MyRatingState.NOT_APPLICABLE, null, null);
    }
    Instant windowEndsAt = ride.getCompletedAt().plus(WINDOW);
    if (rating != null) {
      return new MyRatingDto(MyRatingState.SUBMITTED, windowEndsAt, (int) rating.getScore());
    }
    return new MyRatingDto(
        clock.instant().isAfter(windowEndsAt) ? MyRatingState.EXPIRED : MyRatingState.PENDING,
        windowEndsAt,
        null);
  }

  @Override
  public int refreshSnapshots() {
    return ratingRepository.rewriteSnapshots(clock.instant());
  }

  private static RideParty sideOf(Ride ride, UUID userId) {
    if (userId.equals(ride.getRiderUserId())) {
      return RideParty.RIDER;
    }
    if (userId.equals(ride.getDriverUserId())) {
      return RideParty.DRIVER;
    }
    return null;
  }

  /**
   * Parses the caller's side query parameter.
   *
   * @param as the wire value
   * @return the side
   */
  static RideParty parseSide(String as) {
    if (RideParty.RIDER.getValue().equals(as)) {
      return RideParty.RIDER;
    }
    if (RideParty.DRIVER.getValue().equals(as)) {
      return RideParty.DRIVER;
    }
    throw new InvalidRequestException("as must be rider or driver");
  }

  private static ConflictException conflict(String message, String code) {
    return (ConflictException) new ConflictException(message).withCode(code);
  }

  private static ConflictException alreadyRated() {
    return conflict("You already rated this ride", "rating_already_submitted");
  }
}
