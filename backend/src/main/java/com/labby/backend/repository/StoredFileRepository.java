package com.labby.backend.repository;

import com.labby.backend.model.StoredFile;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Private uploads (NFR-S2). */
public interface StoredFileRepository extends JpaRepository<StoredFile, UUID> {

  /** Ownership-checked lookup: an applicant may only reference their own uploads. */
  Optional<StoredFile> findByIdAndOwnerUserId(UUID id, UUID ownerUserId);

  /**
   * Uploads a user made since the instant (the rolling daily cap shared by {@code /driver/files}
   * and {@code /report-files}).
   */
  long countByOwnerUserIdAndCreatedAtAfter(UUID ownerUserId, Instant since);

  /**
   * Uploads created before the cutoff that no document, vehicle photo or report (M11) references —
   * the nightly cleanup's candidates, oldest first.
   *
   * @param cutoff only files created before this instant
   * @param limit the batch size
   * @return the orphaned files
   */
  @Query(
      value =
          """
          SELECT f.* FROM stored_files f
          WHERE f.created_at < :cutoff
            AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.stored_file_id = f.stored_file_id)
            AND NOT EXISTS (
                SELECT 1 FROM vehicle_photos p WHERE p.stored_file_id = f.stored_file_id)
            AND NOT EXISTS (
                SELECT 1 FROM report_photos r WHERE r.stored_file_id = f.stored_file_id)
          ORDER BY f.created_at
          LIMIT :limit
          """,
      nativeQuery = true)
  List<StoredFile> findOrphansCreatedBefore(
      @Param("cutoff") Instant cutoff, @Param("limit") int limit);
}
