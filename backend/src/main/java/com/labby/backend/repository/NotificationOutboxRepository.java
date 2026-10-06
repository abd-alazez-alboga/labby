package com.labby.backend.repository;

import com.labby.backend.model.NotificationOutboxEntry;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Notifications queued for delivery; the M6 dispatcher drains it (oldest first). */
public interface NotificationOutboxRepository extends JpaRepository<NotificationOutboxEntry, UUID> {

  List<NotificationOutboxEntry> findByUserIdOrderByCreatedAtAsc(UUID userId);

  /**
   * Undelivered entries whose event has a template, oldest first.
   *
   * @param events the renderable event keys
   * @param limit the batch size
   * @return the entry ids
   */
  @Query(
      value =
          """
          SELECT notification_outbox_id FROM notification_outbox
          WHERE delivered_at IS NULL AND event IN (:events)
          ORDER BY created_at, notification_outbox_id
          LIMIT :limit
          """,
      nativeQuery = true)
  List<UUID> findPendingIds(@Param("events") Collection<String> events, @Param("limit") int limit);

  /**
   * One undelivered entry, locked for this delivery; another dispatcher holding it is skipped.
   *
   * @param id the entry id
   * @return the entry, or empty when delivered or locked elsewhere
   */
  @Query(
      value =
          """
          SELECT * FROM notification_outbox
          WHERE notification_outbox_id = :id AND delivered_at IS NULL
          FOR UPDATE SKIP LOCKED
          """,
      nativeQuery = true)
  Optional<NotificationOutboxEntry> lockPending(@Param("id") UUID id);
}
