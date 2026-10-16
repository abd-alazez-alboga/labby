package com.labby.backend.service;

import com.labby.backend.dto.MyRatingDto;
import com.labby.backend.dto.OwnRatingAggregateDto;
import com.labby.backend.dto.PendingRatingDto;
import com.labby.backend.dto.RatingRequestDto;
import com.labby.backend.enums.RideParty;
import com.labby.backend.model.Ride;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Ratings (RATE-01..03, USR-05; trust-v1.yaml): rating a completed ride's counterpart within 7
 * days, once, immutably; the exposed snapshot averages (RATE-02). The RATE-03 flag and USR-05
 * auto-suspension run in the daily job ({@link RatingEvaluationService}).
 */
public interface RatingService {

  /**
   * Stores the caller's rating of the ride's counterpart. USR-05 / RATE-03 are NOT evaluated here
   * (review B-H1) — the daily {@link RatingSnapshotJob} does.
   *
   * @param userId the caller (the ride's rider or driver)
   * @param rideId the ride
   * @param request score and optional comment
   * @throws com.labby.backend.exception.ResourceNotFoundException unknown ride
   * @throws com.labby.backend.exception.ForbiddenException not a party
   * @throws com.labby.backend.exception.ConflictException {@code ride_not_completed}, {@code
   *     rating_window_closed}, {@code rating_already_submitted}
   */
  void rate(UUID userId, UUID rideId, RatingRequestDto request);

  /**
   * The caller's completed rides on a side still inside the window and unrated, newest first.
   *
   * @param userId the caller
   * @param as {@code rider} or {@code driver}
   * @return the prompts
   * @throws com.labby.backend.exception.InvalidRequestException for an invalid {@code as}
   */
  List<PendingRatingDto> pending(UUID userId, String as);

  /**
   * The caller's exposed per-role averages, one per rider/driver role held.
   *
   * @param userId the caller
   * @return the aggregates
   */
  List<OwnRatingAggregateDto> ownAggregates(UUID userId);

  /**
   * One role's exposed aggregate (daily snapshot; average null below 5 ratings).
   *
   * @param userId the user
   * @param role the role
   * @return the aggregate
   */
  OwnRatingAggregateDto ownAggregate(UUID userId, RideParty role);

  /**
   * The exposed average a counterpart sees in matching contexts (rides-v1 summaries).
   *
   * @param userId the user
   * @param role the role
   * @return the snapshot average, or null below 5 ratings
   */
  BigDecimal exposedAverage(UUID userId, RideParty role);

  /**
   * The caller's own rating state for a ride (rides-v1 {@code Ride.myRating}).
   *
   * @param ride the ride
   * @param side the caller's side
   * @return the state
   */
  MyRatingDto myRating(Ride ride, RideParty side);

  /**
   * The caller's own rating states for a page of rides (history), with one ratings query.
   *
   * @param rides the rides
   * @param side the caller's side
   * @return the state per ride id
   */
  Map<UUID, MyRatingDto> myRatings(List<Ride> rides, RideParty side);

  /**
   * Rewrites the RATE-02 snapshots the refresh rule allows (the daily job; review B-W1): none yet,
   * at least 3 new ratings, or the first exposure.
   *
   * @return the snapshots written
   */
  int refreshSnapshots();
}
