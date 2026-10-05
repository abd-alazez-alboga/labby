package com.labby.backend.repository;

import com.labby.backend.model.NotificationOutboxEntry;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Notifications queued for M6 delivery. */
public interface NotificationOutboxRepository extends JpaRepository<NotificationOutboxEntry, UUID> {

  List<NotificationOutboxEntry> findByUserIdOrderByCreatedAtAsc(UUID userId);
}
