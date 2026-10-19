package com.labby.backend.repository;

import com.labby.backend.model.Feedback;
import com.labby.backend.repository.projection.FeedbackBucketRow;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Feedback entries (FDBK-01, V26). */
public interface FeedbackRepository
    extends JpaRepository<Feedback, UUID>, JpaSpecificationExecutor<Feedback> {

  /**
   * FDBK-01 trends: counts per (UTC bucket, category) in [from, to), {@code bucket} being {@code
   * day}, {@code week} (ISO, Monday) or {@code month}; empty cells are absent (the service fills
   * them).
   */
  @Query(
      value =
          """
          SELECT EXTRACT(EPOCH FROM date_trunc(:bucket, f.created_at AT TIME ZONE 'UTC'))::bigint
                   AS bucketEpoch,
                 f.category AS category, COUNT(*) AS count
          FROM feedback f
          WHERE f.created_at >= :from AND f.created_at < :to
            AND (:submittedAs IS NULL OR f.submitted_as = :submittedAs)
          GROUP BY 1, 2
          ORDER BY 1, 2
          """,
      nativeQuery = true)
  List<FeedbackBucketRow> countByBucket(
      @Param("bucket") String bucket,
      @Param("from") Instant from,
      @Param("to") Instant to,
      @Param("submittedAs") String submittedAs);
}
