package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.security.JwtService;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * M6-T3 acceptance for the realtime WebSocket (realtime-v1.yaml protocol, TRK-01, NFR-P3):
 * first-frame auth (no auth → 4401, expired/revoked → 4401, re-auth keeps the socket), error frames
 * for non-driver / offline / invalid samples without closing, 4400 on malformed frames, ping/pong,
 * idle close — and a load-shaped run of 100 drivers streaming concurrently with every latest
 * position stored within a bounded time. Timeouts are shortened for the test.
 */
class RealtimeSocketIntegrationTest extends AbstractAuthIntegrationTest {

  private static final String JWT_SECRET = "labby-integration-test-secret-0123456789abcdef";
  private static final Duration FRAME_WAIT = Duration.ofSeconds(5);

  @LocalServerPort private int port;
  @Autowired private JwtService jwtService;
  @Autowired private ObjectMapper objectMapper;

  private final HttpClient httpClient = HttpClient.newHttpClient();
  private final List<Client> clients = new ArrayList<>();

  @DynamicPropertySource
  static void realtimeTimeouts(DynamicPropertyRegistry registry) {
    registry.add("labby.realtime.auth-timeout-seconds", () -> "2");
    registry.add("labby.realtime.idle-timeout-seconds", () -> "3");
    registry.add("labby.realtime.check-interval-seconds", () -> "1");
  }

  @AfterEach
  void closeClientsAndDriverRows() {
    for (Client client : clients) {
      client.socket.abort();
    }
    clients.clear();
    jdbcTemplate.update("DELETE FROM driver_locations");
    jdbcTemplate.update("DELETE FROM driver_profiles");
  }

  /** A test socket: frames and the close code are captured. */
  private final class Client implements WebSocket.Listener {

    private final BlockingQueue<JsonNode> frames = new LinkedBlockingQueue<>();
    private final CompletableFuture<Integer> closeCode = new CompletableFuture<>();
    private final StringBuilder partial = new StringBuilder();
    private WebSocket socket;

    @Override
    public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
      partial.append(data);
      if (last) {
        try {
          frames.add(objectMapper.readTree(partial.toString()));
        } catch (Exception ex) {
          throw new IllegalStateException(ex);
        }
        partial.setLength(0);
      }
      webSocket.request(1);
      return null;
    }

    @Override
    public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
      closeCode.complete(statusCode);
      return null;
    }

    @Override
    public void onError(WebSocket webSocket, Throwable error) {
      closeCode.completeExceptionally(error);
    }

    void send(Object frame) {
      try {
        String text = frame instanceof String raw ? raw : objectMapper.writeValueAsString(frame);
        socket.sendText(text, true).get(5, TimeUnit.SECONDS);
      } catch (Exception ex) {
        throw new IllegalStateException(ex);
      }
    }

    JsonNode next() throws InterruptedException {
      JsonNode frame = frames.poll(FRAME_WAIT.toMillis(), TimeUnit.MILLISECONDS);
      assertThat(frame).as("a frame arrived").isNotNull();
      return frame;
    }

    int awaitClose(Duration timeout) throws Exception {
      return closeCode.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
    }

    boolean isOpen() {
      return !closeCode.isDone();
    }
  }

  private Client connect() {
    Client client = new Client();
    client.socket =
        httpClient
            .newWebSocketBuilder()
            .buildAsync(URI.create("ws://localhost:" + port + "/api/v1/realtime"), client)
            .join();
    clients.add(client);
    return client;
  }

  private Client authenticated(String token) throws InterruptedException {
    Client client = connect();
    client.send(Map.of("type", "auth", "token", token));
    JsonNode ready = client.next();
    assertThat(ready.get("type").asText()).isEqualTo("ready");
    return client;
  }

  private static Map<String, Object> sample(double lat, double lng, Instant recordedAt) {
    return Map.of("type", "location", "lat", lat, "lng", lng, "recordedAt", recordedAt.toString());
  }

  /** A seeded approved driver (DB rows + live session) and an access token for it. */
  private record Driver(UUID userId, String token) {}

  private Driver seedDriver(String phone, boolean online) {
    UUID userId =
        jdbcTemplate.queryForObject(
            "INSERT INTO users (phone, password_hash, name) VALUES (?, 'x', ?) RETURNING user_id",
            UUID.class,
            phone,
            "Driver " + phone);
    jdbcTemplate.update(
        "INSERT INTO role_assignments (user_id, role) VALUES (?, 'rider'), (?, 'driver')",
        userId,
        userId);
    jdbcTemplate.update(
        "INSERT INTO driver_profiles (user_id, application_status, personal_review_status,"
            + " is_online, online_changed_at) VALUES (?, 'approved', 'approved', ?, now())",
        userId,
        online);
    UUID sessionId =
        jdbcTemplate.queryForObject(
            "INSERT INTO refresh_tokens (user_id, token_hash, expires_at)"
                + " VALUES (?, ?, now() + interval '1 day') RETURNING refresh_token_id",
            UUID.class,
            userId,
            "hash-" + UUID.randomUUID());
    return new Driver(
        userId, jwtService.issueAccessToken(userId, sessionId, List.of("rider", "driver")));
  }

  @Test
  @DisplayName("no auth frame within the deadline → 4401")
  void shouldCloseWithoutAuth() throws Exception {
    Client client = connect();
    assertThat(client.awaitClose(Duration.ofSeconds(6))).isEqualTo(4401);
  }

  @Test
  @DisplayName("a non-auth first frame, a bad token, or an expired token → 4401")
  void shouldRejectUnauthenticatedFrames() throws Exception {
    Client ping = connect();
    ping.send(Map.of("type", "ping"));
    assertThat(ping.awaitClose(FRAME_WAIT)).isEqualTo(4401);

    Client garbage = connect();
    garbage.send(Map.of("type", "auth", "token", "not-a-jwt"));
    assertThat(garbage.awaitClose(FRAME_WAIT)).isEqualTo(4401);

    Driver driver = seedDriver("+963937000001", true);
    JwtService.AccessClaims claims = jwtService.parseAccessToken(driver.token()).orElseThrow();
    String expired =
        Jwts.builder()
            .subject(driver.userId().toString())
            .claim("typ", "access")
            .claim("sid", claims.sessionId().toString())
            .claim("roles", List.of("driver"))
            .issuedAt(Date.from(Instant.now().minusSeconds(120)))
            .expiration(Date.from(Instant.now().minusSeconds(60)))
            .signWith(Keys.hmacShaKeyFor(JWT_SECRET.getBytes(StandardCharsets.UTF_8)))
            .compact();
    Client late = connect();
    late.send(Map.of("type", "auth", "token", expired));
    assertThat(late.awaitClose(FRAME_WAIT)).isEqualTo(4401);
  }

  @Test
  @DisplayName("ready frame; ping/pong; re-auth with a refreshed token keeps the socket")
  void shouldAuthenticateAndReauthenticate() throws Exception {
    AuthTokensResponseDto session = register("+963937000011", "Secret123!", "Rider One");
    Client client = connect();
    client.send(Map.of("type", "auth", "token", session.accessToken()));
    JsonNode ready = client.next();
    assertThat(ready.get("type").asText()).isEqualTo("ready");
    assertThat(ready.get("userId").asText()).isEqualTo(session.user().id().toString());
    assertThat(ready.get("streamIntervalSeconds").asInt()).isEqualTo(5);
    assertThat(ready.get("staleAfterSeconds").asInt()).isEqualTo(30);

    client.send(Map.of("type", "ping"));
    assertThat(client.next().get("type").asText()).isEqualTo("pong");

    AuthTokensResponseDto refreshed =
        restTemplate
            .postForEntity(
                "/api/v1/auth/refresh",
                Map.of("refreshToken", session.refreshToken()),
                AuthTokensResponseDto.class)
            .getBody();
    client.send(Map.of("type", "auth", "token", refreshed.accessToken()));
    assertThat(client.next().get("type").asText()).isEqualTo("ready");
    client.send(Map.of("type", "ping"));
    assertThat(client.next().get("type").asText()).isEqualTo("pong");
    assertThat(client.isOpen()).isTrue();

    // Unknown frame types are ignored, not fatal.
    client.send(Map.of("type", "offer.accept"));
    client.send(Map.of("type", "ping"));
    assertThat(client.next().get("type").asText()).isEqualTo("pong");

    // Re-auth as ANOTHER account is refused.
    AuthTokensResponseDto other = register("+963937000012", "Secret123!", "Rider Two");
    client.send(Map.of("type", "auth", "token", other.accessToken()));
    assertThat(client.awaitClose(FRAME_WAIT)).isEqualTo(4401);
  }

  @Test
  @DisplayName("revoked session (logout) and an expiring token close the socket with 4401")
  void shouldCloseOnRevocationAndExpiry() throws Exception {
    AuthTokensResponseDto session = register("+963937000021", "Secret123!", "Rider Three");
    Client client = authenticated(session.accessToken());
    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/logout",
                    Map.of("refreshToken", session.refreshToken()),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(client.awaitClose(Duration.ofSeconds(5))).isEqualTo(4401);

    Driver driver = seedDriver("+963937000022", true);
    JwtService.AccessClaims claims = jwtService.parseAccessToken(driver.token()).orElseThrow();
    String shortLived =
        Jwts.builder()
            .subject(driver.userId().toString())
            .claim("typ", "access")
            .claim("sid", claims.sessionId().toString())
            .claim("roles", List.of("driver"))
            .issuedAt(Date.from(Instant.now()))
            .expiration(Date.from(Instant.now().plusSeconds(2)))
            .signWith(Keys.hmacShaKeyFor(JWT_SECRET.getBytes(StandardCharsets.UTF_8)))
            .compact();
    Client expiring = authenticated(shortLived);
    expiring.send(Map.of("type", "ping"));
    assertThat(expiring.next().get("type").asText()).isEqualTo("pong");
    assertThat(expiring.awaitClose(Duration.ofSeconds(6))).isEqualTo(4401);
  }

  @Test
  @DisplayName("rejected samples get error frames without closing; malformed frames → 4400")
  void shouldRejectSamplesWithErrorFrames() throws Exception {
    AuthTokensResponseDto rider = register("+963937000031", "Secret123!", "Rider Four");
    Client riderSocket = authenticated(rider.accessToken());
    riderSocket.send(sample(33.51, 36.29, Instant.now()));
    JsonNode notDriver = riderSocket.next();
    assertThat(notDriver.get("type").asText()).isEqualTo("error");
    assertThat(notDriver.get("code").asText()).isEqualTo("not_driver");

    Driver offline = seedDriver("+963937000032", false);
    Client offlineSocket = authenticated(offline.token());
    offlineSocket.send(sample(33.51, 36.29, Instant.now()));
    assertThat(offlineSocket.next().get("code").asText()).isEqualTo("not_online");

    Driver online = seedDriver("+963937000033", true);
    Client onlineSocket = authenticated(online.token());
    onlineSocket.send(sample(91, 36.29, Instant.now()));
    assertThat(onlineSocket.next().get("code").asText()).isEqualTo("invalid_sample");
    onlineSocket.send(Map.of("type", "location", "lat", 33.5, "lng", 36.3));
    assertThat(onlineSocket.next().get("code").asText()).isEqualTo("invalid_sample");
    onlineSocket.send(Map.of("type", "location", "lat", "north", "lng", 36.3, "recordedAt", "x"));
    assertThat(onlineSocket.next().get("code").asText()).isEqualTo("invalid_sample");
    assertThat(onlineSocket.isOpen()).isTrue();

    Instant recordedAt = Instant.parse("2026-10-06T10:00:00Z");
    onlineSocket.send(
        Map.of(
            "type",
            "location",
            "lat",
            33.5138,
            "lng",
            36.2765,
            "headingDeg",
            90.5,
            "speedMps",
            8.2,
            "accuracyM",
            5,
            "recordedAt",
            recordedAt.toString()));
    // An older sample arriving late is ignored.
    onlineSocket.send(sample(10, 10, recordedAt.minusSeconds(30)));
    onlineSocket.send(Map.of("type", "ping"));
    assertThat(onlineSocket.next().get("type").asText()).isEqualTo("pong");
    Map<String, Object> stored =
        jdbcTemplate.queryForMap(
            "SELECT ST_Y(position) AS lat, ST_X(position) AS lng, heading_deg, speed_mps,"
                + " accuracy_m, recorded_at FROM driver_locations WHERE user_id = ?",
            online.userId());
    assertThat((Double) stored.get("lat")).isEqualTo(33.5138);
    assertThat((Double) stored.get("lng")).isEqualTo(36.2765);
    assertThat(((Number) stored.get("heading_deg")).doubleValue()).isEqualTo(90.5);
    assertThat(((java.sql.Timestamp) stored.get("recorded_at")).toInstant()).isEqualTo(recordedAt);

    onlineSocket.send("{not json");
    assertThat(onlineSocket.awaitClose(FRAME_WAIT)).isEqualTo(4400);
    Client noType = authenticated(online.token());
    noType.send(Map.of("lat", 1));
    assertThat(noType.awaitClose(FRAME_WAIT)).isEqualTo(4400);
  }

  @Test
  @DisplayName("a socket without frames past the idle limit is closed")
  void shouldCloseIdleSockets() throws Exception {
    Driver driver = seedDriver("+963937000041", true);
    Client client = authenticated(driver.token());
    assertThat(client.awaitClose(Duration.ofSeconds(8))).isEqualTo(1000);
  }

  @Test
  @DisplayName("load: 100 drivers streaming concurrently, every latest position stored promptly")
  void shouldIngestHundredConcurrentStreamsWithoutBacklog() throws Exception {
    int drivers = 100;
    int samplesPerDriver = 3;
    List<Driver> seeded = new ArrayList<>();
    for (int i = 0; i < drivers; i++) {
      seeded.add(seedDriver("+96393710%04d".formatted(i), true));
    }
    List<Client> sockets = new ArrayList<>();
    for (Driver driver : seeded) {
      Client client = connect();
      client.send(Map.of("type", "auth", "token", driver.token()));
      sockets.add(client);
    }
    for (Client client : sockets) {
      assertThat(client.next().get("type").asText()).isEqualTo("ready");
    }

    Instant base = Instant.parse("2026-10-06T12:00:00Z");
    Instant last = base.plusSeconds(5L * (samplesPerDriver - 1));
    long started = System.nanoTime();
    List<CompletableFuture<Void>> streams = new ArrayList<>();
    for (int d = 0; d < drivers; d++) {
      Client client = sockets.get(d);
      double lat = 33.40 + d * 0.001;
      streams.add(
          CompletableFuture.runAsync(
              () -> {
                for (int s = 0; s < samplesPerDriver; s++) {
                  client.send(sample(lat, 36.20 + s * 0.001, base.plusSeconds(5L * s)));
                }
              }));
    }
    CompletableFuture.allOf(streams.toArray(CompletableFuture[]::new)).get(30, TimeUnit.SECONDS);

    int stored = 0;
    long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
    while (System.nanoTime() < deadline) {
      stored =
          jdbcTemplate.queryForObject(
              "SELECT count(*) FROM driver_locations WHERE recorded_at = ?",
              Integer.class,
              java.sql.Timestamp.from(last));
      if (stored == drivers) {
        break;
      }
      Thread.sleep(100);
    }
    Duration elapsed = Duration.ofNanos(System.nanoTime() - started);

    assertThat(stored).as("latest position of every driver stored").isEqualTo(drivers);
    // 300 samples at the 5 s cadence are one interval's worth of fleet traffic: all of it must be
    // stored well inside a single interval, i.e. no backlog builds up.
    assertThat(elapsed).isLessThan(Duration.ofSeconds(5));
    for (Client client : sockets) {
      assertThat(client.frames).as("no error frames").isEmpty();
    }
  }
}
