package com.labby.backend.service;

import java.io.IOException;
import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/**
 * The authenticated realtime sockets connected to THIS instance, by account. Sockets are inherently
 * instance-bound; events reach them through {@link RealtimePublisher} (Postgres NOTIFY), which
 * every instance's {@link RealtimeNotificationListener} delivers here — so no event depends on
 * which instance produced it (NFR-P4).
 */
@Slf4j
@Component
public class RealtimeSessionRegistry {

  private final Map<UUID, Set<WebSocketSession>> sessions = new ConcurrentHashMap<>();

  /**
   * Registers an authenticated socket (thread-safe sending decorator expected).
   *
   * @param userId the account
   * @param session the socket
   */
  public void register(UUID userId, WebSocketSession session) {
    sessions.computeIfAbsent(userId, key -> ConcurrentHashMap.newKeySet()).add(session);
  }

  /**
   * Forgets a socket.
   *
   * @param userId the account
   * @param session the socket
   */
  public void unregister(UUID userId, WebSocketSession session) {
    sessions.computeIfPresent(
        userId,
        (key, set) -> {
          set.remove(session);
          return set.isEmpty() ? null : set;
        });
  }

  /**
   * Sends a serialized frame to every local socket of the accounts.
   *
   * @param userIds the recipients
   * @param json the frame
   */
  public void deliverLocal(Collection<UUID> userIds, String json) {
    TextMessage message = new TextMessage(json);
    for (UUID userId : userIds) {
      for (WebSocketSession session : sessions.getOrDefault(userId, Set.of())) {
        if (!session.isOpen()) {
          continue;
        }
        try {
          session.sendMessage(message);
        } catch (IOException | IllegalStateException ex) {
          log.debug("Realtime delivery failed: {}", ex.getClass().getSimpleName());
        }
      }
    }
  }
}
