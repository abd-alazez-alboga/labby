package com.labby.backend.load;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * M15-T5 load scenario (SRS NFR-P1/P2): N drivers streaming GPS every 5 s and taking rides, M
 * riders booking and reading, against a RUNNING backend. Never part of the build: the class name
 * matches no surefire include, and it is skipped unless {@code -Dlabby.load.baseUrl} is set. Run:
 *
 * <pre>
 * ./mvnw test -Dtest=LoadScenario -Dsurefire.failIfNoSpecifiedTests=false \
 *   -Dlabby.load.baseUrl=http://localhost:8080 \
 *   -Dlabby.load.dbUrl=jdbc:postgresql://localhost:5433/labby -Dlabby.load.dbUser=labby \
 *   -Dlabby.load.dbPassword=labby -Dlabby.load.drivers=300 -Dlabby.load.riders=700 \
 *   -Dlabby.load.durationSeconds=600
 * </pre>
 *
 * Accounts ({@code +96399…} phones), driver profiles, vehicles and documents are seeded straight
 * into the database of the target (an active region with an enabled service type must exist); every
 * request then goes through the real API. Results (per-endpoint latency percentiles, error counts,
 * booking → first offer, location ingestion lag) are written to {@code target/load-results.json}
 * and printed.
 */
@Tag("load")
class LoadScenario {

  private static final String PASSWORD = "LoadTest1!";
  private static final ObjectMapper JSON = new ObjectMapper();

  private final String baseUrl = System.getProperty("labby.load.baseUrl");
  private final String dbUrl = System.getProperty("labby.load.dbUrl", "");
  private final String dbUser = System.getProperty("labby.load.dbUser", "labby");
  private final String dbPassword = System.getProperty("labby.load.dbPassword", "labby");
  private final int drivers = Integer.getInteger("labby.load.drivers", 300);
  private final int riders = Integer.getInteger("labby.load.riders", 700);
  private final int durationSeconds = Integer.getInteger("labby.load.durationSeconds", 600);
  private final int rampSeconds = Integer.getInteger("labby.load.rampSeconds", 60);

  /** Share of rider think-cycles that book a ride (the rest only read). */
  private final double bookShare =
      Double.parseDouble(System.getProperty("labby.load.bookShare", "0.25"));

  private final HttpClient http =
      HttpClient.newBuilder()
          .version(HttpClient.Version.HTTP_1_1)
          .connectTimeout(Duration.ofSeconds(10))
          .executor(Executors.newVirtualThreadPerTaskExecutor())
          .build();
  private final Map<String, ConcurrentLinkedQueue<Long>> latencies = new ConcurrentHashMap<>();
  private final Map<String, AtomicInteger> errors = new ConcurrentHashMap<>();
  private final Map<String, AtomicInteger> statusCounts = new ConcurrentHashMap<>();
  private final AtomicInteger ridesBooked = new AtomicInteger();
  private final AtomicInteger ridesCompleted = new AtomicInteger();
  private volatile boolean running = true;

  private record Area(UUID regionId, UUID serviceTypeId, double lat, double lng) {}

  private record Account(UUID userId, String phone) {}

  @Test
  void run() throws Exception {
    assumeTrue(baseUrl != null && !baseUrl.isBlank(), "set -Dlabby.load.baseUrl to run");
    String runId = Long.toString(System.currentTimeMillis() % 100_000_000L, 36);
    Instant seeded;
    Area area;
    List<Account> driverAccounts;
    List<Account> riderAccounts;
    try (Connection db = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
      area = area(db);
      String hash = new BCryptPasswordEncoder().encode(PASSWORD);
      driverAccounts = seedAccounts(db, "1", drivers, hash, true, area);
      riderAccounts = seedAccounts(db, "2", riders, hash, false, area);
      seeded = Instant.now();
    }
    System.out.printf(
        "seeded %d drivers + %d riders (run %s) in region %s%n",
        driverAccounts.size(), riderAccounts.size(), runId, area.regionId());

    Map<UUID, String> tokens = new ConcurrentHashMap<>();
    try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
      for (Account account : driverAccounts) {
        pool.submit(() -> tokens.put(account.userId(), login(account.phone(), "driver")));
      }
      for (Account account : riderAccounts) {
        pool.submit(() -> tokens.put(account.userId(), login(account.phone(), "rider")));
      }
    }
    latencies.remove("POST /auth/login"); // setup traffic, not part of the measured mix
    System.out.printf("logged in %d accounts%n", tokens.size());

    Instant start = Instant.now();
    ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor();
    for (int i = 0; i < driverAccounts.size(); i++) {
      Account account = driverAccounts.get(i);
      long delay = (long) rampSeconds * 1000 * i / Math.max(1, driverAccounts.size());
      workers.submit(() -> driverLoop(tokens.get(account.userId()), area, delay));
    }
    for (int i = 0; i < riderAccounts.size(); i++) {
      Account account = riderAccounts.get(i);
      long delay = (long) rampSeconds * 1000 * i / Math.max(1, riderAccounts.size());
      workers.submit(() -> riderLoop(tokens.get(account.userId()), area, delay));
    }
    Thread.sleep(Duration.ofSeconds(durationSeconds));
    Instant stopped = Instant.now();
    running = false;
    workers.shutdown();
    workers.awaitTermination(90, TimeUnit.SECONDS);
    workers.shutdownNow();
    Instant end = Instant.now();

    Map<String, Object> results = new LinkedHashMap<>();
    results.put("runId", runId);
    results.put("startedAt", start.toString());
    results.put("endedAt", end.toString());
    results.put("drivers", driverAccounts.size());
    results.put("riders", riderAccounts.size());
    results.put("concurrentUsers", driverAccounts.size() + riderAccounts.size());
    results.put("durationSeconds", Duration.between(start, end).toSeconds());
    results.put("ridesBooked", ridesBooked.get());
    results.put("ridesCompleted", ridesCompleted.get());
    results.put("endpoints", endpointStats());
    results.put("statusCounts", new java.util.TreeMap<>(statusCounts));
    try (Connection db = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
      results.put("firstOffer", firstOfferStats(db, start, driverAccounts));
      results.put("ingestion", ingestionStats(db, driverAccounts, stopped));
    }
    String report = JSON.writerWithDefaultPrettyPrinter().writeValueAsString(results);
    Files.writeString(Path.of("target", "load-results.json"), report);
    System.out.println(report);
    System.out.printf("seeded at %s; results in target/load-results.json%n", seeded);
  }

  // ---- seeding ----------------------------------------------------------------------------------

  private static Area area(Connection db) throws SQLException {
    try (PreparedStatement statement =
            db.prepareStatement(
                "SELECT r.region_id, s.service_type_id, ST_Y(ST_Centroid(r.boundary)) AS lat,"
                    + " ST_X(ST_Centroid(r.boundary)) AS lng FROM regions r JOIN service_types s"
                    + " ON s.region_id = r.region_id AND s.enabled WHERE r.state = 'active'"
                    + " ORDER BY r.created_at, s.created_at LIMIT 1");
        ResultSet rs = statement.executeQuery()) {
      if (!rs.next()) {
        throw new IllegalStateException("No active region with an enabled service type");
      }
      return new Area(
          rs.getObject(1, UUID.class),
          rs.getObject(2, UUID.class),
          rs.getDouble(3),
          rs.getDouble(4));
    }
  }

  private static List<Account> seedAccounts(
      Connection db, String kind, int count, String hash, boolean driver, Area area)
      throws SQLException {
    List<Account> accounts = new ArrayList<>();
    db.setAutoCommit(false);
    String salt = String.format(Locale.ROOT, "%04d", ThreadLocalRandom.current().nextInt(10_000));
    for (int i = 0; i < count; i++) {
      UUID userId = UUID.randomUUID();
      String phone = "+96399" + kind + salt + String.format(Locale.ROOT, "%05d", i);
      exec(
          db,
          "INSERT INTO users (user_id, phone, password_hash, name, language, state,"
              + " terms_accepted_at) VALUES (?, ?, ?, ?, 'en', 'active', now())",
          userId,
          phone,
          hash,
          (driver ? "Load Driver " : "Load Rider ") + i);
      exec(
          db,
          "INSERT INTO role_assignments (user_id, role, state) VALUES (?, 'rider', 'active')",
          userId);
      if (driver) {
        seedDriver(db, userId, i, area);
      }
      accounts.add(new Account(userId, phone));
    }
    db.commit();
    db.setAutoCommit(true);
    return accounts;
  }

  private static void seedDriver(Connection db, UUID userId, int index, Area area)
      throws SQLException {
    exec(
        db,
        "INSERT INTO driver_profiles (user_id, application_status, submitted_at, decided_at,"
            + " personal_review_status) VALUES (?, 'approved', now(), now(), 'approved')",
        userId);
    UUID vehicleId = UUID.randomUUID();
    exec(
        db,
        "INSERT INTO vehicles (vehicle_id, driver_user_id, make, model, year, color, plate, seats,"
            + " review_status, reviewed_at, is_active) VALUES (?, ?, 'Kia', 'Rio', 2020, 'White',"
            + " ?, 4, 'approved', now(), true)",
        vehicleId,
        userId,
        "LD-" + userId.toString().substring(0, 8));
    exec(
        db,
        "INSERT INTO vehicle_service_types (vehicle_id, service_type_id) VALUES (?, ?)",
        vehicleId,
        area.serviceTypeId());
    LocalDate validUntil = LocalDate.now().plusDays(365);
    for (String type :
        new String[] {"government_id", "drivers_license", "vehicle_registration", "insurance"}) {
      UUID fileId = UUID.randomUUID();
      exec(
          db,
          "INSERT INTO stored_files (stored_file_id, owner_user_id, kind, storage_key,"
              + " content_type, size_bytes) VALUES (?, ?, 'document', ?, 'image/png', 1)",
          fileId,
          userId,
          "load/" + fileId + ".png");
      boolean vehicleDoc = type.startsWith("vehicle") || type.equals("insurance");
      exec(
          db,
          "INSERT INTO documents (driver_user_id, vehicle_id, type, number, expires_on,"
              + " stored_file_id, review_status, reviewed_at) VALUES (?, ?, ?, ?, ?, ?,"
              + " 'approved', now())",
          userId,
          vehicleDoc ? vehicleId : null,
          type,
          "LOAD-" + index + "-" + type,
          java.sql.Date.valueOf(validUntil),
          fileId);
    }
    exec(
        db,
        "INSERT INTO role_assignments (user_id, role, state) VALUES (?, 'driver', 'active')",
        userId);
  }

  private static void exec(Connection db, String sql, Object... args) throws SQLException {
    try (PreparedStatement statement = db.prepareStatement(sql)) {
      for (int i = 0; i < args.length; i++) {
        statement.setObject(i + 1, args[i]);
      }
      statement.executeUpdate();
    }
  }

  // ---- traffic ----------------------------------------------------------------------------------

  private String login(String phone, String client) {
    JsonNode body =
        call(
            "POST /auth/login",
            "POST",
            "/api/v1/auth/login",
            null,
            Map.of("phone", phone, "password", PASSWORD, "client", client));
    if (body == null || !body.hasNonNull("accessToken")) {
      throw new IllegalStateException("login failed for " + phone);
    }
    return body.get("accessToken").asText();
  }

  private void driverLoop(String token, Area area, long startDelayMs) {
    if (token == null) {
      return;
    }
    ThreadLocalRandom random = ThreadLocalRandom.current();
    sleep(startDelayMs);
    double[] position = {
      area.lat() + random.nextDouble(-0.02, 0.02), area.lng() + random.nextDouble(-0.02, 0.02)
    };
    call(
        "PUT /driver/availability",
        "PUT",
        "/api/v1/driver/availability",
        token,
        Map.of("online", true));
    // Two fixed schedules: a GPS sample every 5 s (NFR-P1) and an offer poll every 2 s; the loop
    // sleeps until whichever is due first, so the 5 s cadence is not stretched by the poll.
    long nextSample = 0;
    long nextPoll = 0;
    while (running) {
      long now = System.currentTimeMillis();
      if (now >= nextSample) {
        position[0] += random.nextDouble(-0.0005, 0.0005);
        position[1] += random.nextDouble(-0.0005, 0.0005);
        sendLocation(token, position);
        nextSample = nextSample == 0 || now - nextSample > 5_000 ? now + 5_000 : nextSample + 5_000;
      }
      if (now >= nextPoll) {
        nextPoll = now + 2_000;
        JsonNode offer =
            call("GET /driver/offers/open", "GET", "/api/v1/driver/offers/open", token, null);
        if (offer != null && offer.hasNonNull("id")) {
          JsonNode accepted =
              call(
                  "POST /driver/offers/{id}/accept",
                  "POST",
                  "/api/v1/driver/offers/" + offer.get("id").asText() + "/accept",
                  token,
                  null);
          if (accepted != null && accepted.hasNonNull("id")) {
            driveRide(token, accepted, position);
            nextSample = 0;
            nextPoll = 0;
            continue;
          }
        }
      }
      sleep(Math.max(1, Math.min(nextSample, nextPoll) - System.currentTimeMillis()));
    }
  }

  /** Accepted → stream toward the pickup → arrive → start → complete → collect cash. */
  private void driveRide(String token, JsonNode ride, double[] position) {
    String rideId = ride.get("id").asText();
    JsonNode pickup = ride.path("pickup");
    position[0] = pickup.path("lat").asDouble(position[0]);
    position[1] = pickup.path("lng").asDouble(position[1]);
    sleep(5_000);
    sendLocation(token, position);
    call(
        "POST /driver/rides/{id}/arrive",
        "POST",
        "/api/v1/driver/rides/" + rideId + "/arrive",
        token,
        null);
    sleep(3_000);
    call(
        "POST /driver/rides/{id}/start",
        "POST",
        "/api/v1/driver/rides/" + rideId + "/start",
        token,
        null);
    JsonNode destination = ride.path("destination");
    for (int step = 0; step < 4 && running; step++) {
      sleep(5_000);
      position[0] += (destination.path("lat").asDouble(position[0]) - position[0]) / (4 - step);
      position[1] += (destination.path("lng").asDouble(position[1]) - position[1]) / (4 - step);
      sendLocation(token, position);
    }
    JsonNode completed =
        call(
            "POST /driver/rides/{id}/complete",
            "POST",
            "/api/v1/driver/rides/" + rideId + "/complete",
            token,
            null);
    if (completed != null) {
      ridesCompleted.incrementAndGet();
      call(
          "POST /driver/rides/{id}/cash-confirm",
          "POST",
          "/api/v1/driver/rides/" + rideId + "/cash-confirm",
          token,
          null);
    }
  }

  private void sendLocation(String token, double[] position) {
    call(
        "POST /driver/locations",
        "POST",
        "/api/v1/driver/locations",
        token,
        Map.of(
            "samples",
            List.of(
                Map.of(
                    "lat", position[0],
                    "lng", position[1],
                    "recordedAt", Instant.now().toString()))));
  }

  private void riderLoop(String token, Area area, long startDelayMs) {
    if (token == null) {
      return;
    }
    ThreadLocalRandom random = ThreadLocalRandom.current();
    sleep(startDelayMs);
    while (running) {
      if (random.nextDouble() < bookShare) {
        bookAndFollow(token, area, random);
      } else {
        call("GET /rides/active", "GET", "/api/v1/rides/active", token, null);
        call("GET /rides", "GET", "/api/v1/rides?page=0&size=20", token, null);
        call("GET /wallet", "GET", "/api/v1/wallet", token, null);
        call(
            "GET /regions/resolve",
            "GET",
            "/api/v1/regions/resolve?lat=" + area.lat() + "&lng=" + area.lng(),
            token,
            null);
      }
      sleep(random.nextLong(15_000, 45_000));
    }
  }

  private void bookAndFollow(String token, Area area, ThreadLocalRandom random) {
    double lat = area.lat() + random.nextDouble(-0.02, 0.02);
    double lng = area.lng() + random.nextDouble(-0.02, 0.02);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("pickup", Map.of("lat", lat, "lng", lng));
    body.put("destination", Map.of("lat", lat + 0.01, "lng", lng + 0.01));
    body.put("stops", List.of());
    body.put("serviceTypeId", area.serviceTypeId().toString());
    body.put("paymentMethod", "cash");
    JsonNode ride = call("POST /rides", "POST", "/api/v1/rides", token, body);
    if (ride == null || !ride.hasNonNull("id")) {
      return;
    }
    ridesBooked.incrementAndGet();
    String rideId = ride.get("id").asText();
    long deadline = System.currentTimeMillis() + 600_000;
    while (running && System.currentTimeMillis() < deadline) {
      sleep(3_000);
      JsonNode current = call("GET /rides/{id}", "GET", "/api/v1/rides/" + rideId, token, null);
      String state = current == null ? "" : current.path("state").asText();
      if (state.equals("completed")
          || state.startsWith("cancelled")
          || state.equals("no_driver_found")) {
        return;
      }
    }
  }

  private JsonNode call(String name, String method, String path, String token, Object body) {
    try {
      HttpRequest.Builder request =
          HttpRequest.newBuilder(URI.create(baseUrl + path))
              .timeout(Duration.ofSeconds(30))
              .header("Accept", "application/json");
      if (token != null) {
        request.header("Authorization", "Bearer " + token);
      }
      if (body != null) {
        request
            .header("Content-Type", "application/json")
            .method(method, HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
      } else {
        request.method(method, HttpRequest.BodyPublishers.noBody());
      }
      long started = System.nanoTime();
      HttpResponse<String> response =
          http.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      long micros = (System.nanoTime() - started) / 1_000;
      latencies.computeIfAbsent(name, key -> new ConcurrentLinkedQueue<>()).add(micros);
      statusCounts
          .computeIfAbsent(name + " " + response.statusCode(), key -> new AtomicInteger())
          .incrementAndGet();
      if (response.statusCode() >= 500) {
        errors.computeIfAbsent(name, key -> new AtomicInteger()).incrementAndGet();
      }
      if (response.statusCode() >= 300 || response.body() == null || response.body().isBlank()) {
        return null;
      }
      return JSON.readTree(response.body());
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      return null;
    } catch (Exception failure) {
      errors.computeIfAbsent(name, key -> new AtomicInteger()).incrementAndGet();
      statusCounts
          .computeIfAbsent(name + " io_error", key -> new AtomicInteger())
          .incrementAndGet();
      return null;
    }
  }

  private static void sleep(long millis) {
    try {
      Thread.sleep(Math.max(0, millis));
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
    }
  }

  // ---- results ----------------------------------------------------------------------------------

  private Map<String, Object> endpointStats() {
    Map<String, Object> stats = new java.util.TreeMap<>();
    latencies.forEach(
        (name, queue) -> {
          List<Long> sorted = new ArrayList<>(queue);
          Collections.sort(sorted);
          Map<String, Object> row = new LinkedHashMap<>();
          row.put("count", sorted.size());
          row.put("p50Ms", percentile(sorted, 50));
          row.put("p95Ms", percentile(sorted, 95));
          row.put("p99Ms", percentile(sorted, 99));
          row.put("maxMs", sorted.isEmpty() ? 0 : sorted.get(sorted.size() - 1) / 1000.0);
          row.put("errors", errors.getOrDefault(name, new AtomicInteger()).get());
          stats.put(name, row);
        });
    return stats;
  }

  private static double percentile(List<Long> sortedMicros, int percentile) {
    if (sortedMicros.isEmpty()) {
      return 0;
    }
    int index = (int) Math.ceil(percentile / 100.0 * sortedMicros.size()) - 1;
    return sortedMicros.get(Math.clamp(index, 0, sortedMicros.size() - 1)) / 1000.0;
  }

  /** Booking → first offer (NFR-P2 ≤ 3 s), from the database: the run's rides only. */
  private static Map<String, Object> firstOfferStats(
      Connection db, Instant since, List<Account> drivers) throws SQLException {
    Map<String, Object> stats = new LinkedHashMap<>();
    try (PreparedStatement statement =
        db.prepareStatement(
            "SELECT EXTRACT(EPOCH FROM (MIN(o.offered_at) - r.requested_at)) * 1000 AS ms"
                + " FROM rides r LEFT JOIN ride_offers o"
                + " ON o.ride_id = r.ride_id AND o.driver_user_id = ANY (?)"
                + " WHERE r.requested_at >= ?"
                + " GROUP BY r.ride_id, r.requested_at ORDER BY ms")) {
      statement.setArray(
          1, db.createArrayOf("uuid", drivers.stream().map(Account::userId).toArray()));
      statement.setObject(2, java.sql.Timestamp.from(since));
      List<Long> values = new ArrayList<>();
      int withoutOffer = 0;
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          double ms = rs.getDouble(1);
          if (rs.wasNull()) {
            // Never offered: counted apart so it cannot drop out of the p95.
            withoutOffer++;
          } else {
            values.add((long) (ms * 1000));
          }
        }
      }
      stats.put("ridesWithOffer", values.size());
      stats.put("ridesWithoutOffer", withoutOffer);
      stats.put("p50Ms", percentile(values, 50));
      stats.put("p95Ms", percentile(values, 95));
      stats.put("maxMs", values.isEmpty() ? 0 : values.get(values.size() - 1) / 1000.0);
      stats.put("over3s", values.stream().filter(v -> v > 3_000_000).count());
    }
    try (PreparedStatement statement =
        db.prepareStatement(
            "SELECT state, count(*) FROM rides WHERE requested_at >= ? GROUP BY state")) {
      statement.setObject(1, java.sql.Timestamp.from(since));
      Map<String, Long> states = new java.util.TreeMap<>();
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          states.put(rs.getString(1), rs.getLong(2));
        }
      }
      stats.put("rideStates", states);
    }
    return stats;
  }

  /** Location ingestion (NFR-P2/P3): server receive lag vs the sample time, and freshness now. */
  private static Map<String, Object> ingestionStats(
      Connection db, List<Account> drivers, Instant stopped) throws SQLException {
    Map<String, Object> stats = new LinkedHashMap<>();
    try (PreparedStatement statement =
        db.prepareStatement(
            "SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY lag),"
                + " percentile_cont(0.95) WITHIN GROUP (ORDER BY lag), max(lag), count(*),"
                + " count(*) FILTER (WHERE received_at >= ?)"
                + " FROM (SELECT EXTRACT(EPOCH FROM (received_at - recorded_at)) * 1000 AS lag,"
                + " received_at FROM driver_locations WHERE user_id = ANY (?)) s")) {
      statement.setObject(1, java.sql.Timestamp.from(stopped.minusSeconds(15)));
      statement.setArray(
          2, db.createArrayOf("uuid", drivers.stream().map(Account::userId).toArray()));
      try (ResultSet rs = statement.executeQuery()) {
        rs.next();
        stats.put("lastSampleReceiveLagP50Ms", rs.getDouble(1));
        stats.put("lastSampleReceiveLagP95Ms", rs.getDouble(2));
        stats.put("lastSampleReceiveLagMaxMs", rs.getDouble(3));
        stats.put("driversWithPosition", rs.getLong(4));
        // A last sample within 3 cycles of the stop means the driver kept the cadence to the end.
        stats.put("driversFreshWithin15s", rs.getLong(5));
      }
    }
    return stats;
  }
}
