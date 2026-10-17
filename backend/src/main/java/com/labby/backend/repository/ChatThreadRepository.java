package com.labby.backend.repository;

import com.labby.backend.model.ChatThread;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Chat threads, one per ride x rider (CHAT-01, V21). */
public interface ChatThreadRepository extends JpaRepository<ChatThread, UUID> {

  Optional<ChatThread> findByRideIdAndRiderUserId(UUID rideId, UUID riderUserId);

  List<ChatThread> findByRideId(UUID rideId);

  boolean existsByRideIdAndRiderUserId(UUID rideId, UUID riderUserId);
}
