package com.labby.backend.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.config.RealtimeProperties;
import com.labby.backend.config.TrackingProperties;
import com.labby.backend.dto.LocationSampleDto;
import com.labby.backend.exception.BusinessException;
import com.labby.backend.security.JwtService;
import com.labby.backend.service.ChatService;
import com.labby.backend.service.DriverLocationService;
import com.labby.backend.service.RealtimeSessionRegistry;
import com.labby.backend.service.SessionService;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * The realtime WebSocket {@code GET /api/v1/realtime} (realtime-v1.yaml protocol; TRK-01, NFR-P3).
 * JSON text frames: the first must be {@code auth} with an access token, validated exactly like a
 * Bearer header (signature, expiry, live session) — never in the URL; later {@code auth} frames
 * refresh it. Drivers stream {@code location} samples (fire-and-forget; rejected samples get an
 * {@code error} frame without closing); {@code ping} → {@code pong}. Closes: 4401 when the auth
 * deadline passes, a token is invalid/expired/for another user, or the session is revoked; 4400 on
 * a malformed frame; normal close after the idle limit. Unknown frame types are ignored. Once
 * authenticated, the socket is registered for server events (rides-v1.yaml) on this instance's
 * {@link RealtimeSessionRegistry}, which every instance feeds from Postgres NOTIFY. Stateless
 * beyond the socket itself (NFR-P4): per-socket state lives in the session attributes, positions go
 * straight to the database.
 */
@Slf4j
@Component
public class RealtimeSocketController extends TextWebSocketHandler
    implements WebSocketConfigurer, DisposableBean {

  /** The endpoint path (whitelisted in the security chain: auth happens in-protocol). */
  public static final String PATH = "/api/v1/realtime";

  static final CloseStatus UNAUTHORIZED = new CloseStatus(4401, "unauthorized");
  static final CloseStatus MALFORMED = new CloseStatus(4400, "malformed frame");
  static final CloseStatus IDLE = CloseStatus.NORMAL.withReason("idle timeout");

  private static final String STATE_ATTRIBUTE = "labby.realtime.state";
  private static final int SEND_TIME_LIMIT_MS = 5_000;
  private static final int SEND_BUFFER_LIMIT_BYTES = 64 * 1024;

  private final JwtService jwtService;
  private final SessionService sessionService;
  private final DriverLocationService driverLocationService;
  private final ChatService chatService;
  private final RealtimeSessionRegistry realtimeSessionRegistry;
  private final ObjectMapper objectMapper;
  private final Validator validator;
  private final TrackingProperties trackingProperties;
  private final RealtimeProperties realtimeProperties;
  private final Clock clock;
  private final ScheduledExecutorService timers;

  public RealtimeSocketController(
      JwtService jwtService,
      SessionService sessionService,
      DriverLocationService driverLocationService,
      ChatService chatService,
      RealtimeSessionRegistry realtimeSessionRegistry,
      ObjectMapper objectMapper,
      Validator validator,
      TrackingProperties trackingProperties,
      RealtimeProperties realtimeProperties,
      Clock clock) {
    this.jwtService = jwtService;
    this.sessionService = sessionService;
    this.driverLocationService = driverLocationService;
    this.chatService = chatService;
    this.realtimeSessionRegistry = realtimeSessionRegistry;
    this.objectMapper = objectMapper;
    this.validator = validator;
    this.trackingProperties = trackingProperties;
    this.realtimeProperties = realtimeProperties;
    this.clock = clock;
    AtomicInteger threads = new AtomicInteger();
    ScheduledThreadPoolExecutor executor =
        new ScheduledThreadPoolExecutor(
            2,
            runnable -> {
              Thread thread = new Thread(runnable, "realtime-timer-" + threads.incrementAndGet());
              thread.setDaemon(true);
              return thread;
            });
    executor.setRemoveOnCancelPolicy(true);
    this.timers = executor;
  }

  @Override
  public void registerWebSocketHandlers(@NonNull WebSocketHandlerRegistry registry) {
    // Any origin: the socket carries no ambient credentials (token in the first frame only).
    registry.addHandler(this, PATH).setAllowedOriginPatterns("*");
  }

  @Override
  public void afterConnectionEstablished(@NonNull WebSocketSession session) {
    SocketState state =
        new SocketState(
            new ConcurrentWebSocketSessionDecorator(
                session, SEND_TIME_LIMIT_MS, SEND_BUFFER_LIMIT_BYTES),
            clock.instant());
    session.getAttributes().put(STATE_ATTRIBUTE, state);
    state.authDeadline =
        timers.schedule(
            () -> {
              if (state.userId == null) {
                close(state, UNAUTHORIZED);
              }
            },
            realtimeProperties.authTimeout().toMillis(),
            TimeUnit.MILLISECONDS);
    long interval = realtimeProperties.checkIntervalSeconds();
    state.watchdog =
        timers.scheduleWithFixedDelay(() -> check(state), interval, interval, TimeUnit.SECONDS);
  }

  @Override
  protected void handleTextMessage(
      @NonNull WebSocketSession session, @NonNull TextMessage message) {
    SocketState state = (SocketState) session.getAttributes().get(STATE_ATTRIBUTE);
    if (state == null) {
      return;
    }
    state.lastFrameAt = clock.instant();
    JsonNode frame;
    try {
      frame = objectMapper.readTree(message.getPayload());
    } catch (JsonProcessingException ex) {
      close(state, MALFORMED);
      return;
    }
    if (frame == null || !frame.isObject() || !frame.path("type").isTextual()) {
      close(state, MALFORMED);
      return;
    }
    String type = frame.get("type").asText();
    if ("auth".equals(type)) {
      authenticate(state, frame);
      return;
    }
    if (state.userId == null) {
      close(state, UNAUTHORIZED);
      return;
    }
    switch (type) {
      case "ping" -> send(state, Map.of("type", "pong"));
      case "location" -> location(state, frame);
      case "chat.send" -> chatSend(state, frame);
      case "chat.read" -> chatRead(state, frame);
      default -> log.debug("Ignoring realtime frame of unknown type {}", type);
    }
  }

  @Override
  public void handleTransportError(
      @NonNull WebSocketSession session, @NonNull Throwable exception) {
    log.debug("Realtime transport error: {}", exception.getClass().getSimpleName());
  }

  @Override
  public void afterConnectionClosed(
      @NonNull WebSocketSession session, @NonNull CloseStatus status) {
    SocketState state = (SocketState) session.getAttributes().get(STATE_ATTRIBUTE);
    if (state != null) {
      state.cancelTimers();
      if (state.userId != null) {
        realtimeSessionRegistry.unregister(state.userId, state.session);
      }
    }
  }

  @Override
  public void destroy() {
    timers.shutdownNow();
  }

  private void authenticate(SocketState state, JsonNode frame) {
    JsonNode token = frame.path("token");
    Optional<JwtService.AccessClaims> claims =
        token.isTextual()
            ? jwtService
                .parseAccessToken(token.asText())
                .filter(parsed -> sessionService.isSessionLive(parsed.sessionId()))
            : Optional.empty();
    if (claims.isEmpty() || (state.userId != null && !state.userId.equals(claims.get().userId()))) {
      close(state, UNAUTHORIZED);
      return;
    }
    state.sessionId = claims.get().sessionId();
    state.expiresAt = claims.get().expiresAt();
    if (state.userId == null) {
      // First auth: from now on the socket receives the account's server events (rides-v1.yaml).
      realtimeSessionRegistry.register(claims.get().userId(), state.session);
    }
    state.userId = claims.get().userId();
    if (state.authDeadline != null) {
      state.authDeadline.cancel(false);
    }
    Map<String, Object> ready = new LinkedHashMap<>();
    ready.put("type", "ready");
    ready.put("userId", state.userId.toString());
    ready.put("streamIntervalSeconds", trackingProperties.streamIntervalSeconds());
    ready.put("staleAfterSeconds", trackingProperties.staleAfterSeconds());
    send(state, ready);
  }

  private void location(SocketState state, JsonNode frame) {
    LocationSampleDto sample;
    try {
      sample = objectMapper.treeToValue(frame, LocationSampleDto.class);
    } catch (JsonProcessingException | IllegalArgumentException ex) {
      error(state, "invalid_sample", "The sample could not be read");
      return;
    }
    Set<ConstraintViolation<LocationSampleDto>> violations = validator.validate(sample);
    if (!violations.isEmpty()) {
      ConstraintViolation<LocationSampleDto> first = violations.iterator().next();
      error(state, "invalid_sample", first.getPropertyPath() + " " + first.getMessage());
      return;
    }
    DriverLocationService.Outcome outcome;
    try {
      outcome = driverLocationService.ingest(state.userId, sample);
    } catch (RuntimeException ex) {
      // A storage hiccup drops this sample only; the next one (5 s later) retries naturally.
      log.warn("Location sample not stored: {}", ex.getClass().getSimpleName());
      return;
    }
    switch (outcome) {
      case NOT_ONLINE -> error(state, "not_online", "Go online before streaming your location");
      case NOT_DRIVER -> error(state, "not_driver", "This account is not a driver");
      default -> {
        // Stored, or ignored as older than the current fix: no acknowledgement (fire-and-forget).
      }
    }
  }

  /**
   * The {@code chat.send} frame (comms-v1.yaml): validation, window and dedup live in the service;
   * a refusal becomes an {@code error} frame with the contract's code, the socket stays open. The
   * echo (and the counterpart's copy) arrives as a {@code chat.message} frame after commit.
   */
  private void chatSend(SocketState state, JsonNode frame) {
    UUID rideId = uuid(frame, "rideId");
    UUID clientMsgId = uuid(frame, "clientMsgId");
    if (rideId == null || clientMsgId == null) {
      error(state, "invalid_message", "rideId and clientMsgId must be UUIDs");
      return;
    }
    try {
      chatService.send(
          state.userId,
          new ChatService.SendRequest(
              rideId,
              clientMsgId,
              frame.path("kind").isTextual() ? frame.get("kind").asText() : null,
              frame.path("body").isTextual() ? frame.get("body").asText() : null,
              frame.path("quickReplyCode").isTextual()
                  ? frame.get("quickReplyCode").asText()
                  : null));
    } catch (BusinessException ex) {
      error(state, ex.getCode() == null ? "invalid_message" : ex.getCode(), ex.getMessage());
    } catch (RuntimeException ex) {
      // A storage hiccup drops this send only; the client's resend deduplicates naturally.
      log.warn("Chat send not stored: {}", ex.getClass().getSimpleName());
    }
  }

  /** The {@code chat.read} frame: records the marker and relays it to the counterpart. */
  private void chatRead(SocketState state, JsonNode frame) {
    UUID rideId = uuid(frame, "rideId");
    UUID lastReadMessageId = uuid(frame, "lastReadMessageId");
    if (rideId == null || lastReadMessageId == null) {
      error(state, "invalid_message", "rideId and lastReadMessageId must be UUIDs");
      return;
    }
    try {
      chatService.markRead(state.userId, rideId, lastReadMessageId);
    } catch (BusinessException ex) {
      error(state, ex.getCode() == null ? "invalid_message" : ex.getCode(), ex.getMessage());
    } catch (RuntimeException ex) {
      log.warn("Chat read not stored: {}", ex.getClass().getSimpleName());
    }
  }

  private static UUID uuid(JsonNode frame, String field) {
    JsonNode value = frame.path(field);
    if (!value.isTextual()) {
      return null;
    }
    try {
      return UUID.fromString(value.asText());
    } catch (IllegalArgumentException ex) {
      return null;
    }
  }

  /** Periodic per-socket check: idleness, token expiry, session revocation. */
  private void check(SocketState state) {
    try {
      if (!state.session.isOpen()) {
        state.cancelTimers();
        return;
      }
      Instant now = clock.instant();
      if (Duration.between(state.lastFrameAt, now).compareTo(realtimeProperties.idleTimeout())
          >= 0) {
        close(state, IDLE);
        return;
      }
      if (state.userId != null
          && (!now.isBefore(state.expiresAt) || !sessionService.isSessionLive(state.sessionId))) {
        close(state, UNAUTHORIZED);
      }
    } catch (RuntimeException ex) {
      // Never let an exception cancel the periodic check.
      log.warn("Realtime socket check failed: {}", ex.getClass().getSimpleName());
    }
  }

  private void error(SocketState state, String code, String message) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "error");
    frame.put("code", code);
    frame.put("message", message);
    send(state, frame);
  }

  private void send(SocketState state, Map<String, Object> frame) {
    try {
      state.session.sendMessage(new TextMessage(objectMapper.writeValueAsString(frame)));
    } catch (IOException | IllegalStateException ex) {
      log.debug("Realtime send failed: {}", ex.getClass().getSimpleName());
    }
  }

  private void close(SocketState state, CloseStatus status) {
    state.cancelTimers();
    try {
      state.session.close(status);
    } catch (IOException | IllegalStateException ex) {
      log.debug("Realtime close failed: {}", ex.getClass().getSimpleName());
    }
  }

  /** Per-socket state, held in the socket's session attributes only. */
  private static final class SocketState {

    private final WebSocketSession session;
    private volatile Instant lastFrameAt;
    private volatile UUID userId;
    private volatile UUID sessionId;
    private volatile Instant expiresAt;
    private volatile ScheduledFuture<?> authDeadline;
    private volatile ScheduledFuture<?> watchdog;

    private SocketState(WebSocketSession session, Instant connectedAt) {
      this.session = session;
      this.lastFrameAt = connectedAt;
    }

    private void cancelTimers() {
      if (authDeadline != null) {
        authDeadline.cancel(false);
      }
      if (watchdog != null) {
        watchdog.cancel(false);
      }
    }
  }
}
