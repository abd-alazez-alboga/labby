package com.labby.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Publishes through Postgres {@code NOTIFY} on channel {@value #CHANNEL} (owner decision
 * 2026-10-07): NOTIFY is transactional — it is delivered only when the surrounding transaction
 * commits, so a rolled-back transition never reaches a client — and every instance LISTENs and
 * delivers to its own sockets. Payload: {@code {"u": [userIds], "f": frame}}, at most {@value
 * #MAX_PAYLOAD_BYTES} bytes (Postgres caps NOTIFY payloads below 8000 bytes).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PgNotifyRealtimePublisher implements RealtimePublisher {

  /** The NOTIFY channel shared with {@link RealtimeNotificationListener}. */
  public static final String CHANNEL = "labby_realtime";

  static final int MAX_PAYLOAD_BYTES = 7900;

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  @Override
  public void publish(Collection<UUID> userIds, Map<String, Object> frame) {
    if (userIds.isEmpty()) {
      return;
    }
    Map<String, Object> envelope = new LinkedHashMap<>();
    envelope.put("u", userIds.stream().map(UUID::toString).toList());
    envelope.put("f", frame);
    String payload;
    try {
      payload = objectMapper.writeValueAsString(envelope);
    } catch (JsonProcessingException ex) {
      throw new IllegalStateException("Realtime frame not serializable", ex);
    }
    if (payload.getBytes(StandardCharsets.UTF_8).length > MAX_PAYLOAD_BYTES) {
      // Never expected for ride frames (~2 KB); clients resync from REST on their next fetch.
      log.error("Realtime frame {} too large for NOTIFY; not published", frame.get("type"));
      return;
    }
    jdbcTemplate.queryForObject("SELECT pg_notify(?, ?)::text", String.class, CHANNEL, payload);
  }
}
