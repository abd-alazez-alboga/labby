package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.config.SurgeProperties;
import com.labby.backend.service.SurgeService;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.convention.TestBean;

/**
 * NFR-P4 surge cycle with the cycle cron ENABLED, as in production (the shared test config disables
 * it, see {@link SurgeIntegrationTest}): concurrent runs never fail and process every zone exactly
 * once, and a zone already computed in the current cycle (within half a period) is skipped, so
 * several instances never do the same work twice. The job itself stays unscheduled ({@code
 * labby.surge.cycle-cron} is still "-"): only the service sees the 2-minute cron.
 */
class SurgeCycleIntegrationTest extends AbstractRideIntegrationTest {

  @TestBean private SurgeProperties surgeProperties;

  @Autowired private SurgeService surgeService;

  static SurgeProperties surgeProperties() {
    return new SurgeProperties("0 */2 * * * *");
  }

  private static Map<String, Object> square(
      double minLng, double minLat, double maxLng, double maxLat) {
    return Map.of(
        "type",
        "Polygon",
        "coordinates",
        List.of(
            List.of(
                List.of(minLng, minLat),
                List.of(maxLng, minLat),
                List.of(maxLng, maxLat),
                List.of(minLng, maxLat),
                List.of(minLng, minLat))));
  }

  /** Draws a zone with the SRS default steps through the admin API; returns its id. */
  private UUID zone(String name, Map<String, Object> polygon) {
    Map<String, Object> body = new HashMap<>();
    body.put("name", name);
    body.put("polygon", polygon);
    body.put(
        "thresholdSteps",
        List.of(
            Map.of("ratio", 2, "multiplier", 1.2),
            Map.of("ratio", 3, "multiplier", 1.5),
            Map.of("ratio", 5, "multiplier", 2.0)));
    JsonNode created =
        ok(
            post("/api/v1/admin/regions/" + regionId + "/surge-zones", body, admin),
            HttpStatus.CREATED);
    return UUID.fromString(created.get("id").asText());
  }

  private UUID centerZone() {
    return zone("Center", square(36.25, 33.45, 36.35, 33.55));
  }

  private JsonNode zoneState(String name) {
    JsonNode state =
        ok(get("/api/v1/admin/regions/" + regionId + "/surge-state", admin), HttpStatus.OK);
    for (JsonNode zone : state.get("zones")) {
      if (zone.get("name").asText().equals(name)) {
        return zone;
      }
    }
    throw new AssertionError("no zone " + name);
  }

  @Test
  @DisplayName("NFR-P4: concurrent cycles never fail and process every zone exactly once")
  void shouldRunConcurrentCyclesSafely() throws Exception {
    centerZone();
    zone("Outer", square(36.36, 33.56, 36.39, 33.59));
    book(rider()); // demand 1, no supply → Center at the top step 2.00

    List<SurgeService.CycleResult> results = new ArrayList<>();
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      CountDownLatch start = new CountDownLatch(1);
      List<Future<SurgeService.CycleResult>> runs = new ArrayList<>();
      for (int i = 0; i < 2; i++) {
        runs.add(
            executor.submit(
                () -> {
                  start.await();
                  return surgeService.recompute();
                }));
      }
      start.countDown();
      for (Future<SurgeService.CycleResult> run : runs) {
        results.add(run.get());
      }
    } finally {
      executor.shutdownNow();
    }

    // Asserted right after the parallel runs: no repair cycle in between.
    assertThat(results).allSatisfy(result -> assertThat(result.failed()).isZero());
    assertThat(results.stream().mapToInt(SurgeService.CycleResult::processed).sum()).isEqualTo(2);
    assertThat(results.stream().mapToInt(SurgeService.CycleResult::skipped).sum()).isEqualTo(2);
    assertThat(zoneState("Center").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("2.00");
    assertThat(zoneState("Outer").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("1.00");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM surge_zones WHERE computed_at IS NULL", Integer.class))
        .isZero();
  }

  @Test
  @DisplayName("NFR-P4: a zone computed in this cycle is skipped until half a period has passed")
  void shouldSkipZonesAlreadyComputedInThisCycle() {
    UUID centerId = centerZone();
    book(rider()); // demand 1, no supply → 2.00

    assertThat(surgeService.recompute()).isEqualTo(new SurgeService.CycleResult(1, 0, 0));
    assertThat(zoneState("Center").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("2.00");

    // A second instance firing on the same cycle does no work, even with new inputs.
    ok(
        put(
            "/api/v1/admin/surge-zones/" + centerId + "/override",
            Map.of("multiplier", 1.5),
            admin),
        HttpStatus.OK);
    assertThat(surgeService.recompute()).isEqualTo(new SurgeService.CycleResult(0, 1, 0));
    advance(Duration.ofSeconds(59)); // still within half the 2-minute period
    assertThat(surgeService.recompute()).isEqualTo(new SurgeService.CycleResult(0, 1, 0));
    assertThat(zoneState("Center").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("2.00");

    advance(Duration.ofSeconds(2)); // past half a period: the next cycle
    assertThat(surgeService.recompute()).isEqualTo(new SurgeService.CycleResult(1, 0, 0));
    assertThat(zoneState("Center").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("1.50");
  }
}
