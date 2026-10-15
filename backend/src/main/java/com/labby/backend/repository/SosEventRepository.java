package com.labby.backend.repository;

import com.labby.backend.model.SosEvent;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** SOS events (SAFE-01/02): append-only facts, writable handling fields only. */
public interface SosEventRepository extends JpaRepository<SosEvent, UUID> {

  /**
   * One admin alert-list page, newest first (UC-A-20). {@code status}: {@code open} (no
   * acknowledgement), {@code acknowledged}, or {@code all}; {@code regionId} filters through the
   * event's ride; the keyset cursor pages strictly older than (created_at, id).
   *
   * @param status the status filter
   * @param regionId optional region (as text; null = all regions)
   * @param beforeAt the cursor's created_at, or null for the first page
   * @param beforeId the cursor's id (tie-break; any value when beforeAt is null)
   * @param limit page size (+1 to detect a next page)
   * @return the rows
   */
  @Query(
      value =
          """
          SELECT s.* FROM sos_events s
          JOIN rides r ON r.ride_id = s.ride_id
          WHERE (:status = 'all'
                 OR (:status = 'open' AND s.acknowledged_at IS NULL)
                 OR (:status = 'acknowledged' AND s.acknowledged_at IS NOT NULL))
            AND (:regionId IS NULL OR r.region_id = CAST(:regionId AS uuid))
            AND (CAST(:beforeAt AS timestamptz) IS NULL
                 OR s.created_at < :beforeAt
                 OR (s.created_at = :beforeAt AND s.sos_event_id < :beforeId))
          ORDER BY s.created_at DESC, s.sos_event_id DESC
          LIMIT :limit
          """,
      nativeQuery = true)
  List<SosEvent> findAdminPage(
      @Param("status") String status,
      @Param("regionId") String regionId,
      @Param("beforeAt") Instant beforeAt,
      @Param("beforeId") UUID beforeId,
      @Param("limit") int limit);

  /** The OPEN events of a region, newest first — the live ops red pins (ADM-03). */
  @Query(
      value =
          """
          SELECT s.* FROM sos_events s
          JOIN rides r ON r.ride_id = s.ride_id
          WHERE s.acknowledged_at IS NULL AND r.region_id = :regionId
          ORDER BY s.created_at DESC, s.sos_event_id DESC
          """,
      nativeQuery = true)
  List<SosEvent> findOpenByRegion(@Param("regionId") UUID regionId);

  /**
   * Stamps the handling fields of a still-OPEN event (SAFE-01 stand-down). Conditional, so of two
   * concurrent acknowledges exactly one wins: the loser waits on the row lock, re-checks {@code
   * acknowledged_at IS NULL} against the committed winner and updates nothing.
   *
   * @param id the event
   * @param by the acknowledging admin
   * @param at when
   * @param note the optional note
   * @return 1 when stamped, 0 when the event is unknown or already acknowledged
   */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query(
      value =
          """
          UPDATE sos_events SET acknowledged_by = :by, acknowledged_at = :at, note = :note
          WHERE sos_event_id = :id AND acknowledged_at IS NULL
          """,
      nativeQuery = true)
  int acknowledgeIfOpen(
      @Param("id") UUID id,
      @Param("by") UUID by,
      @Param("at") Instant at,
      @Param("note") String note);

  /** The rides among the given ones that have an open SOS event (the red flag). */
  @Query(
      """
      SELECT DISTINCT s.rideId FROM SosEvent s
      WHERE s.rideId IN :rideIds AND s.acknowledgedAt IS NULL
      """)
  List<UUID> findOpenRideIds(@Param("rideIds") Collection<UUID> rideIds);
}
