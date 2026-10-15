package com.labby.backend.repository;

import com.labby.backend.model.NotificationOutboxEntry;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Notifications queued for delivery; the M6 dispatcher drains it (SOS first, then oldest). */
public interface NotificationOutboxRepository extends JpaRepository<NotificationOutboxEntry, UUID> {

  List<NotificationOutboxEntry> findByUserIdOrderByCreatedAtAsc(UUID userId);

  /**
   * Undelivered entries whose event has a template and that no dispatcher holds a live claim on:
   * SOS alerts (category safety) first, then oldest first — a chat backlog never delays an SOS.
   *
   * @param events the renderable event keys
   * @param staleBefore claims older than this are stale (their dispatcher died) and claimable
   * @param limit the batch size
   * @return the entry ids
   */
  @Query(
      value =
          """
          SELECT notification_outbox_id FROM notification_outbox
          WHERE delivered_at IS NULL AND event IN (:events)
            AND (claimed_at IS NULL OR claimed_at < :staleBefore)
          ORDER BY (event = 'sos.triggered') DESC, created_at, notification_outbox_id
          LIMIT :limit
          """,
      nativeQuery = true)
  List<UUID> findPendingIds(
      @Param("events") Collection<String> events,
      @Param("staleBefore") Instant staleBefore,
      @Param("limit") int limit);

  /**
   * One undelivered, unclaimed (or stale-claimed) entry, locked so the caller can claim it in the
   * same transaction; an entry locked by, or freshly claimed by, another dispatcher is skipped.
   *
   * @param id the entry id
   * @param staleBefore claims older than this are stale and may be taken over
   * @return the entry, or empty when delivered, claimed or locked elsewhere
   */
  @Query(
      value =
          """
          SELECT * FROM notification_outbox
          WHERE notification_outbox_id = :id AND delivered_at IS NULL
            AND (claimed_at IS NULL OR claimed_at < :staleBefore)
          FOR UPDATE SKIP LOCKED
          """,
      nativeQuery = true)
  Optional<NotificationOutboxEntry> lockClaimable(
      @Param("id") UUID id, @Param("staleBefore") Instant staleBefore);

  /**
   * Whether an event was already queued for a ride — the ride monitor's once-only guard for the
   * wait-charge notice (PRC-03), restart- and multi-instance-safe because the outbox keeps
   * delivered rows.
   *
   * @param event the event key
   * @param rideId the ride id (as the params carry it)
   * @return true when queued before
   */
  @Query(
      value =
          """
          SELECT EXISTS (SELECT 1 FROM notification_outbox
                         WHERE event = :event AND params->>'rideId' = :rideId)
          """,
      nativeQuery = true)
  boolean existsByEventAndRideId(@Param("event") String event, @Param("rideId") String rideId);
}
