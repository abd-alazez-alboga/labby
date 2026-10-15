package com.labby.backend.repository;

import com.labby.backend.enums.RideParty;
import com.labby.backend.model.Rating;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** RATE-01 ratings: insert-only (V17 trigger), one per ride per rater side. */
public interface RatingRepository extends JpaRepository<Rating, UUID> {

  boolean existsByRideIdAndRaterRole(UUID rideId, RideParty raterRole);

  /** The rating a side gave on a ride (the caller's own {@code myRating}). */
  Optional<Rating> findByRideIdAndRaterRole(UUID rideId, RideParty raterRole);

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
   * Rewrites every RATE-02 snapshot from the live lifetime aggregates (2 decimals, half up — PG
   * {@code ROUND} on numeric rounds half away from zero, i.e. half up for positive averages).
   *
   * @param now the snapshot moment
   * @return the rows written
   */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO rating_snapshots (user_id, role, avg_score, rating_count, computed_at)
          SELECT rated_user_id, rated_role, ROUND(AVG(score), 2), COUNT(*), :now
          FROM ratings
          GROUP BY rated_user_id, rated_role
          ON CONFLICT (user_id, role) DO UPDATE
            SET avg_score = EXCLUDED.avg_score,
                rating_count = EXCLUDED.rating_count,
                computed_at = EXCLUDED.computed_at
          """,
      nativeQuery = true)
  int rewriteSnapshots(@Param("now") Instant now);

  /** One user x role's live aggregate. */
  interface LiveAggregate {
    long getRatingCount();

    BigDecimal getAverage();
  }
}
