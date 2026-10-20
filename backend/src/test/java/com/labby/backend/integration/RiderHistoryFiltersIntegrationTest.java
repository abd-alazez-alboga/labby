package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * V1 conformance W41 (UC-R-16 "list with filters"): {@code GET /rides} filters the rider's history
 * by state group, kind and an inclusive region-local date range, combined with paging. The region
 * runs in Asia/Damascus (UTC+3), so a ride at 01:29 local on 4 Oct is on 3 Oct in UTC.
 */
class RiderHistoryFiltersIntegrationTest extends AbstractTrustIntegrationTest {

  private static final ZoneId DAMASCUS = ZoneId.of("Asia/Damascus");

  private Account rider;
  private UUID onDemand;
  private UUID scheduled;
  private UUID shared;
  private UUID riderCancelled;
  private UUID driverCancelled;
  private UUID noDriver;

  private static Instant local(int day, int hour, int minute) {
    return LocalDateTime.of(2026, 10, day, hour, minute).atZone(DAMASCUS).toInstant();
  }

  @BeforeEach
  void history() {
    jdbcTemplate.update(
        "UPDATE regions SET time_zone = 'Asia/Damascus' WHERE region_id = ?", regionId);
    rider = newRider();
    Account driver = newDriver();
    // Requested 60 s before acceptance (the fixture), so each ride runs at "accepted − 1 min".
    shared = completed(driver, local(6, 12, 1));
    jdbcTemplate.update(
        "UPDATE rides SET kind = 'shared', payment_status = 'split' WHERE ride_id = ?", shared);
    onDemand = completed(driver, local(5, 10, 1));
    scheduled = completed(driver, local(4, 1, 30)); // runs 01:29 local on 4 Oct = 3 Oct UTC
    jdbcTemplate.update("UPDATE rides SET kind = 'scheduled' WHERE ride_id = ?", scheduled);
    riderCancelled =
        ride(
            rider.userId(),
            driver.userId(),
            "cancelled_by_rider",
            local(2, 12, 1),
            null,
            null,
            local(2, 12, 5));
    driverCancelled =
        ride(
            rider.userId(),
            driver.userId(),
            "cancelled_by_driver",
            local(1, 12, 1),
            null,
            null,
            local(1, 12, 5));
    CLOCK.set(local(1, 8, 1));
    noDriver = ride(rider.userId(), null, "no_driver_found", null, null, null, null);
  }

  private UUID completed(Account driver, Instant acceptedAt) {
    return ride(
        rider.userId(),
        driver.userId(),
        "completed",
        acceptedAt,
        acceptedAt.plusSeconds(120),
        acceptedAt.plusSeconds(1800),
        null);
  }

  private JsonNode page(String query) {
    return ok(get("/api/v1/rides?" + query, rider.token()), HttpStatus.OK);
  }

  private List<UUID> ids(String query) {
    List<UUID> ids = new ArrayList<>();
    page(query).get("items").forEach(item -> ids.add(UUID.fromString(item.get("id").asText())));
    return ids;
  }

  @Test
  @DisplayName("no filter lists every ride, newest first, each row labelled with its kind")
  void shouldListEverythingWithoutFilters() {
    JsonNode all = page("size=20");
    assertThat(all.get("totalItems").asLong()).isEqualTo(6);
    assertThat(ids("size=20"))
        .containsExactly(shared, onDemand, scheduled, riderCancelled, driverCancelled, noDriver);
    assertThat(all.get("items").get(0).get("kind").asText()).isEqualTo("shared");
    assertThat(all.get("items").get(2).get("kind").asText()).isEqualTo("scheduled");
    assertThat(all.get("items").get(1).get("kind").asText()).isEqualTo("on_demand");
  }

  @Test
  @DisplayName("state groups: completed, and cancelled = by rider, by driver or no driver found")
  void shouldFilterByStateGroup() {
    assertThat(ids("state=completed")).containsExactly(shared, onDemand, scheduled);
    assertThat(ids("state=cancelled")).containsExactly(riderCancelled, driverCancelled, noDriver);
  }

  @Test
  @DisplayName("kinds: scheduled, shared, on_demand")
  void shouldFilterByKind() {
    assertThat(ids("kind=scheduled")).containsExactly(scheduled);
    assertThat(ids("kind=shared")).containsExactly(shared);
    assertThat(ids("kind=on_demand"))
        .containsExactly(onDemand, riderCancelled, driverCancelled, noDriver);
  }

  @Test
  @DisplayName("dates are inclusive region-local days; filters combine with each other and paging")
  void shouldFilterByRegionLocalDays() {
    // 01:29 local on 4 Oct belongs to 4 Oct, not to 3 Oct (its UTC date).
    assertThat(ids("from=2026-10-04&to=2026-10-04")).containsExactly(scheduled);
    assertThat(ids("to=2026-10-03")).containsExactly(riderCancelled, driverCancelled, noDriver);
    assertThat(ids("from=2026-10-05")).containsExactly(shared, onDemand);
    assertThat(ids("state=cancelled&kind=on_demand&from=2026-10-02"))
        .containsExactly(riderCancelled);
    assertThat(ids("state=completed&from=2026-10-07")).isEmpty();

    JsonNode first = page("state=completed&size=2&page=0");
    assertThat(first.get("totalItems").asLong()).isEqualTo(3);
    assertThat(first.get("items")).hasSize(2);
    assertThat(ids("state=completed&size=2&page=1")).containsExactly(scheduled);
  }

  @Test
  @DisplayName("an unknown state or kind, a bad date or from after to is a 400")
  void shouldRejectBadFilters() {
    for (String query :
        List.of(
            "state=active",
            "kind=taxi",
            "from=2026-10-05&to=2026-10-04",
            "from=yesterday",
            "to=2026-13-01")) {
      assertThat(get("/api/v1/rides?" + query, rider.token()).getStatusCode())
          .as(query)
          .isEqualTo(HttpStatus.BAD_REQUEST);
    }
  }
}
