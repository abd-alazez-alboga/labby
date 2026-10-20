package com.labby.backend.repository;

import com.labby.backend.enums.RideParty;
import com.labby.backend.model.Rating;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** RATE-01 ratings: insert-only (V17 trigger), one per ride per rater -> rated pair (V19). */
public interface RatingRepository extends JpaRepository<Rating, UUID> {

  boolean existsByRideIdAndRaterUserIdAndRatedUserId(
      UUID rideId, UUID raterUserId, UUID ratedUserId);

  /** The ratings one user gave on a ride (the caller's own {@code myRating}). */
  List<Rating> findByRideIdAndRaterUserId(UUID rideId, UUID raterUserId);

  /**
   * The ratings a user received from a moment up to and including one rating, any role, oldest
   * first (M13 five-star week; V1 audit I22 reads the rolling window in order; V1 conformance H5
   * evaluates it nightly as of each 5-star rating).
   *
   * @param userId the rated user
   * @param from the window start (inclusive)
   * @param upToAt the last rating's moment
   * @param upToId the last rating (ties at the same moment order by id)
   * @return the ratings, oldest first
   */
  @Query(
      value =
          """
          SELECT * FROM ratings
          WHERE rated_user_id = :userId AND created_at >= :from
            AND (created_at, rating_id) <= (:upToAt, :upToId)
          ORDER BY created_at ASC, rating_id ASC
          """,
      nativeQuery = true)
  List<Rating> receivedUpTo(
      @Param("userId") UUID userId,
      @Param("from") Instant from,
      @Param("upToAt") Instant upToAt,
      @Param("upToId") UUID upToId);

  /**
   * The 5-star ratings the nightly growth pass has not evaluated yet, oldest first (V1 conformance
   * H5, owner ruling 2026-10-20: badges and rating challenges never move when a rating is stored).
   *
   * @return the rating ids
   */
  @Query(
      value =
          """
          SELECT g.rating_id FROM ratings g
          WHERE g.score = 5
            AND NOT EXISTS (SELECT 1 FROM rating_growth_evaluations e
                            WHERE e.rating_id = g.rating_id)
          ORDER BY g.created_at ASC, g.rating_id ASC
          """,
      nativeQuery = true)
  List<UUID> findGrowthPending();

  /**
   * Claims a rating for the nightly growth pass — exactly once by the primary key.
   *
   * @param ratingId the rating
   * @param at the pass moment
   * @return 1 when claimed now, 0 when an earlier (or concurrent) pass already did
   */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO rating_growth_evaluations (rating_id, evaluated_at) VALUES (:ratingId, :at)
          ON CONFLICT (rating_id) DO NOTHING
          """,
      nativeQuery = true)
  int claimGrowthEvaluation(@Param("ratingId") UUID ratingId, @Param("at") Instant at);

  /** The ratings one user gave on a page of rides (history {@code myRating}, one query). */
  List<Rating> findByRideIdInAndRaterUserId(Collection<UUID> rideIds, UUID raterUserId);

  /**
   * The LIVE lifetime aggregate of one user x role (USR-05, RATE-03, admin views): count and exact
   * average (null without ratings).
   *
   * @param userId the rated user
   * @param role the rated role ({@code rider} / {@code driver})
   * @return the aggregate
   */
  @Query(
      value =
          """
          SELECT COUNT(*) AS ratingCount, AVG(score) AS average FROM ratings
          WHERE rated_user_id = :userId AND rated_role = :role
          """,
      nativeQuery = true)
  LiveAggregate liveAggregate(@Param("userId") UUID userId, @Param("role") String role);

  /**
   * Rewrites the RATE-02 snapshots from the live lifetime aggregates (2 decimals, half up — PG
   * {@code ROUND} on numeric rounds half away from zero, i.e. half up for positive averages) — only
   * where the review B-W1 rule allows (owner ruling 2026-10-16): no snapshot yet, at least {@code
   * minNew} new ratings since the stored one, or the first exposure (stored below {@code
   * exposeFrom}, live at or above it). A single new rating therefore never moves the exposed
   * average.
   *
   * @param now the snapshot moment
   * @param minNew the minimum new ratings for a rewrite (3)
   * @param exposeFrom the exposure minimum (5)
   * @return the rows written
   */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO rating_snapshots (user_id, role, avg_score, rating_count, computed_at)
          SELECT a.user_id, a.role, a.avg_score, a.rating_count, :now
          FROM (SELECT rated_user_id AS user_id, rated_role AS role,
                       ROUND(AVG(score), 2) AS avg_score, COUNT(*) AS rating_count
                FROM ratings GROUP BY rated_user_id, rated_role) a
          LEFT JOIN rating_snapshots s ON s.user_id = a.user_id AND s.role = a.role
          WHERE s.user_id IS NULL
             OR a.rating_count - s.rating_count >= :minNew
             OR (s.rating_count < :exposeFrom AND a.rating_count >= :exposeFrom)
          ON CONFLICT (user_id, role) DO UPDATE
            SET avg_score = EXCLUDED.avg_score,
                rating_count = EXCLUDED.rating_count,
                computed_at = EXCLUDED.computed_at
          """,
      nativeQuery = true)
  int rewriteSnapshots(
      @Param("now") Instant now, @Param("minNew") int minNew, @Param("exposeFrom") int exposeFrom);

  /** Every rated user x role — the daily USR-05 / RATE-03 evaluation's candidates. */
  @Query(
      value = "SELECT DISTINCT rated_user_id AS userId, rated_role AS role FROM ratings",
      nativeQuery = true)
  List<RatedPair> findRatedPairs();

  /** Whether a rating of the user x role was stored after the instant (the re-fire rule). */
  boolean existsByRatedUserIdAndRatedRoleAndCreatedAtAfter(
      UUID ratedUserId, RideParty ratedRole, Instant after);

  /**
   * The region of the ride of the user x role's latest rating — whose rule applies.
   *
   * @param userId the rated user
   * @param role the rated role
   * @return the region
   */
  @Query(
      value =
          """
          SELECT r.region_id FROM ratings g JOIN rides r ON r.ride_id = g.ride_id
          WHERE g.rated_user_id = :userId AND g.rated_role = :role
          ORDER BY g.created_at DESC, g.rating_id DESC LIMIT 1
          """,
      nativeQuery = true)
  Optional<UUID> latestRatedRegion(@Param("userId") UUID userId, @Param("role") String role);

  /** A rated user x role. */
  interface RatedPair {
    UUID getUserId();

    String getRole();
  }

  /** One user x role's live aggregate. */
  interface LiveAggregate {
    long getRatingCount();

    BigDecimal getAverage();
  }
}
