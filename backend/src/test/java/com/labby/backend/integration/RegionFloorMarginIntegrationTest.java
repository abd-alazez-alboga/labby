package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * Review V1 W3 / I23 / I18 (owner ruling 2026-10-20): the COM-03 debt floor and floor-warning
 * margin are per-region amounts in the region's currency, and the region bundle reads and writes
 * them together with the time zone and the scheduled-ride timing (keep-on-omit, validated).
 */
class RegionFloorMarginIntegrationTest extends AbstractMoneyIntegrationTest {

  private JsonNode settle(UUID driverUserId, String amount, String direction) {
    return ok(
        post(
            "/api/v1/admin/drivers/" + driverUserId + "/settlements",
            Map.of("amount", amount, "direction", direction, "currency", "SYP"),
            admin),
        HttpStatus.CREATED);
  }

  private JsonNode balanceEntry(UUID driverUserId) {
    return ok(get("/api/v1/admin/drivers/" + driverUserId + "/ledger?size=1", admin), HttpStatus.OK)
        .get("balances")
        .get(0);
  }

  @Test
  @DisplayName("the region's margin decides the warning status, in the region's currency")
  void shouldWarnWithinTheRegionMargin() {
    jdbcTemplate.update(
        "UPDATE regions SET driver_balance_floor = -500000 WHERE region_id = ?", regionId);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);

    // NULL margin = the global 10: 50,000 above the floor is plain ok.
    assertThat(settle(driver.userId(), "450000.00", "pay_out").get("floorStatus").asText())
        .isEqualTo("ok");
    assertThat(settle(driver.userId(), "450000.00", "pay_in").get("floorStatus").asText())
        .isEqualTo("ok");
    assertThat(outboxEvents(driver.userId())).doesNotContain("driver.balance_warning");

    jdbcTemplate.update(
        "UPDATE regions SET floor_warning_margin = 100000 WHERE region_id = ?", regionId);
    assertThat(settle(driver.userId(), "450000.00", "pay_out").get("floorStatus").asText())
        .isEqualTo("warning");
    assertThat(outboxEvents(driver.userId())).contains("driver.balance_warning");
    JsonNode entry = balanceEntry(driver.userId());
    assertThat(entry.get("status").asText()).isEqualTo("warning");
    assertThat(entry.get("floor").decimalValue()).isEqualByComparingTo("-500000");
    assertThat(entry.get("floorRegionId").asText()).isEqualTo(regionId.toString());
    assertThat(entry.get("floorRegionName").asText())
        .isEqualTo(
            jdbcTemplate.queryForObject(
                "SELECT name FROM regions WHERE region_id = ?", String.class, regionId));

    // At the floor it blocks, and offers stop.
    assertThat(settle(driver.userId(), "50000.00", "pay_out").get("floorStatus").asText())
        .isEqualTo("blocked");
    JsonNode availability = ok(get("/api/v1/driver/availability", driver.token()), HttpStatus.OK);
    assertThat(availability.get("offersBlockedReason").asText()).isNotBlank();
  }

  @Test
  @DisplayName("the SRS default floor (another currency) keeps the global margin and no region")
  void shouldFallBackToTheDefaultsForAnotherCurrency() {
    jdbcTemplate.update(
        "UPDATE regions SET floor_warning_margin = 100000 WHERE region_id = ?", regionId);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    // A balance in a currency other than the operating region's (e.g. from an earlier region).
    jdbcTemplate.update(
        "INSERT INTO driver_balances (driver_user_id, currency, balance) VALUES (?, 'USD', -45)",
        driver.userId());
    JsonNode entry = balanceEntry(driver.userId());
    assertThat(entry.get("currency").asText()).isEqualTo("USD");
    assertThat(entry.get("floor").decimalValue()).isEqualByComparingTo("-50");
    assertThat(entry.get("status").asText()).isEqualTo("warning"); // within the global 10
    assertThat(entry.get("floorRegionId").isNull()).isTrue();
    assertThat(entry.get("floorRegionName").isNull()).isTrue();
  }

  @Test
  @DisplayName("the bundle reads and writes floor, margin, time zone and scheduled timing")
  void shouldEditFloorMarginZoneAndScheduledTiming() {
    ResponseEntity<JsonNode> created = post("/api/v1/admin/regions", Map.of("name", "Homs"), admin);
    assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    assertThat(created.getBody().get("floorWarningMargin").isNull()).isTrue();
    String url = "/api/v1/admin/regions/" + created.getBody().get("id").asText();

    Map<String, Object> body = new HashMap<>();
    body.put("name", "Homs");
    body.put("timeZone", "Asia/Beirut");
    body.put("driverBalanceFloor", -500000);
    body.put("floorWarningMargin", 100000);
    body.put(
        "scheduledSettings",
        Map.of(
            "reminderFirstMin", 1440,
            "reminderSecondMin", 60,
            "fallbackLeadMin", 15,
            "minLeadMin", 30));
    JsonNode saved = ok(put(url, body, admin), HttpStatus.OK);
    assertThat(saved.get("timeZone").asText()).isEqualTo("Asia/Beirut");
    assertThat(saved.get("driverBalanceFloor").decimalValue()).isEqualByComparingTo("-500000");
    assertThat(saved.get("floorWarningMargin").decimalValue()).isEqualByComparingTo("100000");
    assertThat(saved.get("scheduledSettings").get("fallbackLeadMin").asInt()).isEqualTo(15);

    // A client that leaves them out keeps all four.
    JsonNode kept = ok(put(url, Map.of("name", "Homs Edited"), admin), HttpStatus.OK);
    assertThat(kept.get("timeZone").asText()).isEqualTo("Asia/Beirut");
    assertThat(kept.get("driverBalanceFloor").decimalValue()).isEqualByComparingTo("-500000");
    assertThat(kept.get("floorWarningMargin").decimalValue()).isEqualByComparingTo("100000");
    assertThat(kept.get("scheduledSettings").get("reminderFirstMin").asInt()).isEqualTo(1440);
    JsonNode read = ok(get(url, admin), HttpStatus.OK);
    assertThat(read.get("floorWarningMargin").decimalValue()).isEqualByComparingTo("100000");

    // Validation: margin above 0, floor at most 0, ordered scheduled timing, known zone.
    for (Map<String, Object> invalid :
        List.<Map<String, Object>>of(
            Map.of("name", "Homs", "floorWarningMargin", 0),
            Map.of("name", "Homs", "floorWarningMargin", -5),
            Map.of("name", "Homs", "driverBalanceFloor", 1),
            Map.of("name", "Homs", "timeZone", "Mars/Olympus"),
            Map.of(
                "name",
                "Homs",
                "scheduledSettings",
                Map.of(
                    "reminderFirstMin", 60,
                    "reminderSecondMin", 60,
                    "fallbackLeadMin", 15,
                    "minLeadMin", 30)),
            Map.of(
                "name",
                "Homs",
                "scheduledSettings",
                Map.of(
                    "reminderFirstMin", 1440,
                    "reminderSecondMin", 60,
                    "fallbackLeadMin", 30,
                    "minLeadMin", 30)))) {
      assertThat(put(url, invalid, admin).getStatusCode())
          .as("%s", invalid)
          .isEqualTo(HttpStatus.BAD_REQUEST);
    }
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT floor_warning_margin FROM regions WHERE name = 'Homs Edited'",
                BigDecimal.class))
        .isEqualByComparingTo("100000");
    // The edit is audited with the new field.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT after_state ->> 'floorWarningMargin' FROM audit_log"
                    + " WHERE action = 'region.update' ORDER BY created_at DESC LIMIT 1",
                String.class))
        .isNotNull();
  }
}
