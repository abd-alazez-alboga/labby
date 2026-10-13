package com.labby.backend.repository;

import com.labby.backend.model.ChatThread;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Per-ride chat threads (CHAT-01). */
public interface ChatThreadRepository extends JpaRepository<ChatThread, UUID> {

  Optional<ChatThread> findByRideId(UUID rideId);

  boolean existsByRideId(UUID rideId);
}
