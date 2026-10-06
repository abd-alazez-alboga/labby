package com.labby.backend.repository;

import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.model.Notification;
import java.util.Collection;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Notification-center entries (NTF-03). */
public interface NotificationRepository extends JpaRepository<Notification, UUID> {

  boolean existsByNotificationOutboxId(UUID notificationOutboxId);

  long countByUserIdAndAudienceInAndReadAtIsNull(
      UUID userId, Collection<NotificationAudience> audiences);
}
