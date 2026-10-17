package com.labby.backend.service;

import com.labby.backend.dto.FileRefDto;
import com.labby.backend.dto.MyRatingDto;
import com.labby.backend.dto.OwnRatingAggregateDto;
import com.labby.backend.dto.PendingRatingDto;
import com.labby.backend.dto.RatingRequestDto;
import com.labby.backend.enums.MyRatingState;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.SharedMemberStatus;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Rating;
import com.labby.backend.model.RatingSnapshot;
import com.labby.backend.model.Ride;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.model.User;
import com.labby.backend.repository.RatingRepository;
import com.labby.backend.repository.RatingSnapshotRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import com.labby.backend.repository.UserRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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

  private final GrowthService growthService;
  private final RatingRepository ratingRepository;
  private final RatingSnapshotRepository ratingSnapshotRepository;
  private final RideRepository rideRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final UserRepository userRepository;
  private final OnboardingAssembler onboardingAssembler;
  private final RideParties rideParties;
  private final SharedRideMemberRepository sharedRideMemberRepository;
  private final Clock clock;

  @Override
  public void rate(UUID userId, UUID rideId, RatingRequestDto request, UUID memberId) {
    Ride ride =
        rideRepository
            .findById(rideId)
            .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    // M12: a completed member rates the driver; the driver rates each completed member.
    RideParty side = rideParties.sideOf(ride, userId, RideParties.COMPLETED);
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
    RideParty ratedRole = side.other();
    UUID ratedUserId = rideParties.counterpart(ride, side, memberId, RideParties.COMPLETED);
    if (ratingRepository.existsByRideIdAndRaterUserIdAndRatedUserId(rideId, userId, ratedUserId)) {
      throw alreadyRated();
    }
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
      throw alreadyRated(); // a concurrent submission of the same pair won the unique constraint
    }
    // USR-05 / RATE-03 are NEVER evaluated here (review B-H1): a suspension right after a ride
    // would identify its rater. The daily RatingSnapshotJob evaluates them.
    // M13: a 5-star rating may finish a 5-star week and advances rating challenges.
    growthService.onRatingSubmitted(ride, ratedUserId, ratedRole, request.score(), now);
  }

  @Override
  @Transactional(readOnly = true)
  public List<PendingRatingDto> pending(UUID userId, String as) {
    RideParty side = parseSide(as);
    List<Ride> rides =
        rideRepository.findRatingPending(userId, side.getValue(), clock.instant().minus(WINDOW));
    // One prompt per unrated counterpart: the driver of a shared ride rates each completed member.
    List<Prompt> targets = new ArrayList<>();
    for (Ride ride : rides) {
      if (side == RideParty.DRIVER && ride.getKind() == RideKind.SHARED) {
        Set<UUID> rated =
            ratingRepository.findByRideIdAndRaterUserId(ride.getId(), userId).stream()
                .map(Rating::getRatedUserId)
                .collect(Collectors.toSet());
        for (SharedRideMember member :
            sharedRideMemberRepository.findByRideIdAndStatusOrderByJoinedAtAsc(
                ride.getId(), SharedMemberStatus.COMPLETED)) {
          if (!rated.contains(member.getRiderUserId())) {
            targets.add(new Prompt(ride, member.getRiderUserId(), member.getId()));
          }
        }
      } else {
        targets.add(
            new Prompt(
                ride,
                side == RideParty.RIDER ? ride.getDriverUserId() : ride.getRiderUserId(),
                null));
      }
    }
    Map<UUID, User> counterparts =
        userRepository
            .findAllById(
                targets.stream().map(Prompt::counterpartUserId).collect(Collectors.toSet()))
            .stream()
            .collect(Collectors.toMap(User::getId, Function.identity()));
    List<PendingRatingDto> prompts = new ArrayList<>();
    for (Prompt target : targets) {
      Ride ride = target.ride();
      User counterpart = counterparts.get(target.counterpartUserId());
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
              ride.getDestinationLabel(),
              target.memberId()));
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
                    snapshot.getComputedAt()))
        .orElseGet(() -> new OwnRatingAggregateDto(role, null, null));
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
  public MyRatingDto myRating(Ride ride, RideParty side, UUID userId) {
    return myRatings(List.of(ride), side, userId).get(ride.getId());
  }

  @Override
  @Transactional(readOnly = true)
  public Map<UUID, MyRatingDto> myRatings(List<Ride> rides, RideParty side, UUID userId) {
    List<UUID> completed =
        rides.stream()
            .filter(ride -> ride.getState() == RideState.COMPLETED)
            .map(Ride::getId)
            .toList();
    Map<UUID, List<Rating>> given =
        completed.isEmpty()
            ? Map.of()
            : ratingRepository.findByRideIdInAndRaterUserId(completed, userId).stream()
                .collect(Collectors.groupingBy(Rating::getRideId));
    Map<UUID, MyRatingDto> states = new LinkedHashMap<>();
    for (Ride ride : rides) {
      List<Rating> mine = given.getOrDefault(ride.getId(), List.of());
      if (side == RideParty.DRIVER
          && ride.getKind() == RideKind.SHARED
          && ride.getState() == RideState.COMPLETED) {
        // M12: the driver's state of a shared ride is submitted once EVERY completed member is
        // rated (no single score); pending prompts carry the members one by one.
        int members =
            sharedRideMemberRepository
                .findByRideIdAndStatusOrderByJoinedAtAsc(ride.getId(), SharedMemberStatus.COMPLETED)
                .size();
        states.put(ride.getId(), toMyRating(ride, mine.size() >= members, null));
      } else {
        states.put(
            ride.getId(),
            toMyRating(
                ride, !mine.isEmpty(), mine.isEmpty() ? null : (int) mine.get(0).getScore()));
      }
    }
    return states;
  }

  /** The state of one ride from whether the caller rated it (and the score, when single). */
  private MyRatingDto toMyRating(Ride ride, boolean submitted, Integer score) {
    if (ride.getState() != RideState.COMPLETED || ride.getCompletedAt() == null) {
      return new MyRatingDto(MyRatingState.NOT_APPLICABLE, null, null);
    }
    Instant windowEndsAt = ride.getCompletedAt().plus(WINDOW);
    if (submitted) {
      return new MyRatingDto(MyRatingState.SUBMITTED, windowEndsAt, score);
    }
    return new MyRatingDto(
        clock.instant().isAfter(windowEndsAt) ? MyRatingState.EXPIRED : MyRatingState.PENDING,
        windowEndsAt,
        null);
  }

  @Override
  public int refreshSnapshots() {
    return ratingRepository.rewriteSnapshots(
        clock.instant(), TrustRules.MIN_NEW_FOR_SNAPSHOT, TrustRules.MIN_EXPOSED_RATINGS);
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

  /** One pending prompt: a ride and the counterpart still to rate (a member on shared rides). */
  private record Prompt(Ride ride, UUID counterpartUserId, UUID memberId) {}
}
