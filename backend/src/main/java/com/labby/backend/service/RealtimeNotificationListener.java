package com.labby.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import lombok.extern.slf4j.Slf4j;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * Each instance LISTENs on {@link PgNotifyRealtimePublisher#CHANNEL} with one dedicated connection
 * and hands every frame to its local {@link RealtimeSessionRegistry}. A lost connection is
 * re-established after a second (frames published meanwhile are missed — clients resync from REST
 * on reconnect, rides-v1.yaml).
 */
@Slf4j
@Component
public class RealtimeNotificationListener implements SmartLifecycle {

  private static final int POLL_MILLIS = 250;
  private static final long RETRY_MILLIS = 1000;

  private final DataSource dataSource;
  private final RealtimeSessionRegistry registry;
  private final ObjectMapper objectMapper;
  private volatile boolean running;
  private Thread thread;

  public RealtimeNotificationListener(
      DataSource dataSource, RealtimeSessionRegistry registry, ObjectMapper objectMapper) {
    this.dataSource = dataSource;
    this.registry = registry;
    this.objectMapper = objectMapper;
  }

  @Override
  public void start() {
    running = true;
    thread = new Thread(this::loop, "realtime-listener");
    thread.setDaemon(true);
    thread.start();
  }

  @Override
  public void stop() {
    running = false;
    if (thread != null) {
      thread.interrupt();
    }
  }

  @Override
  public boolean isRunning() {
    return running;
  }

  private void loop() {
    while (running) {
      try (Connection connection = dataSource.getConnection()) {
        connection.setAutoCommit(true);
        try (Statement statement = connection.createStatement()) {
          statement.execute("LISTEN " + PgNotifyRealtimePublisher.CHANNEL);
        }
        PGConnection pg = connection.unwrap(PGConnection.class);
        while (running) {
          PGNotification[] notifications = pg.getNotifications(POLL_MILLIS);
          if (notifications != null) {
            for (PGNotification notification : notifications) {
              deliver(notification.getParameter());
            }
          }
        }
      } catch (SQLException ex) {
        if (running) {
          log.warn("Realtime listener connection lost; retrying: {}", ex.getMessage());
          sleepBeforeRetry();
        }
      } catch (RuntimeException ex) {
        log.warn("Realtime listener failed; retrying: {}", ex.getClass().getSimpleName());
        sleepBeforeRetry();
      }
    }
  }

  private void deliver(String payload) {
    try {
      JsonNode envelope = objectMapper.readTree(payload);
      List<UUID> userIds = new ArrayList<>();
      envelope.path("u").forEach(id -> userIds.add(UUID.fromString(id.asText())));
      registry.deliverLocal(userIds, objectMapper.writeValueAsString(envelope.path("f")));
    } catch (Exception ex) {
      log.warn("Unreadable realtime notification: {}", ex.getClass().getSimpleName());
    }
  }

  private void sleepBeforeRetry() {
    try {
      Thread.sleep(RETRY_MILLIS);
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
    }
  }
}
