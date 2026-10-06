package com.labby.backend.repository;

import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.model.Notification;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Notification-center entries (NTF-03). */
public interface NotificationRepository extends JpaRepository<Notification, UUID> {

  boolean existsByNotificationOutboxId(UUID notificationOutboxId);

  Optional<Notification> findByNotificationOutboxId(UUID notificationOutboxId);

  Optional<Notification> findByIdAndUserId(UUID id, UUID userId);

  long countByUserIdAndAudienceInAndReadAtIsNull(
      UUID userId, Collection<NotificationAudience> audiences);

  /**
   * The first page of a client's center, newest first (keyset on created_at, id).
   *
   * @param userId the account
   * @param audiences the client's audience + {@code all}
   * @param category optional category filter (null = all)
   * @param limit page size (+1 to detect a next page)
   * @return the rows
   */
  @Query(
      """
      SELECT n FROM Notification n
      WHERE n.userId = :userId AND n.audience IN :audiences
        AND (:category IS NULL OR n.category = :category)
      ORDER BY n.createdAt DESC, n.id DESC
      """)
  List<Notification> findPage(
      @Param("userId") UUID userId,
      @Param("audiences") Collection<NotificationAudience> audiences,
      @Param("category") NotificationCategory category,
      Limit limit);

  /**
   * A following page: rows strictly older than the cursor (created_at, id).
   *
   * @param userId the account
   * @param audiences the client's audience + {@code all}
   * @param category optional category filter (null = all)
   * @param beforeAt the cursor's created_at
   * @param beforeId the cursor's id (tie-break)
   * @param limit page size (+1 to detect a next page)
   * @return the rows
   */
  @Query(
      """
      SELECT n FROM Notification n
      WHERE n.userId = :userId AND n.audience IN :audiences
        AND (:category IS NULL OR n.category = :category)
        AND (n.createdAt < :beforeAt OR (n.createdAt = :beforeAt AND n.id < :beforeId))
      ORDER BY n.createdAt DESC, n.id DESC
      """)
  List<Notification> findPageBefore(
      @Param("userId") UUID userId,
      @Param("audiences") Collection<NotificationAudience> audiences,
      @Param("category") NotificationCategory category,
      @Param("beforeAt") Instant beforeAt,
      @Param("beforeId") UUID beforeId,
      Limit limit);

  /**
   * Marks every unread row of a client's center read.
   *
   * @param userId the account
   * @param audiences the client's audience + {@code all}
   * @param readAt the read time
   * @return rows changed
   */
  @Modifying
  @Query(
      """
      UPDATE Notification n SET n.readAt = :readAt
      WHERE n.userId = :userId AND n.audience IN :audiences AND n.readAt IS NULL
      """)
  int markAllRead(
      @Param("userId") UUID userId,
      @Param("audiences") Collection<NotificationAudience> audiences,
      @Param("readAt") Instant readAt);
}
