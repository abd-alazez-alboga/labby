package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * Review V1 W4 (UC-A-13 "reports made"): {@code GET /admin/reports?reporterUserId=} lists the
 * reports a user filed, as rider or driver, under the queue's status rule and permission.
 */
class AdminReportsByReporterIntegrationTest extends AbstractTrustIntegrationTest {

  private String file(Account reporter, UUID rideId, String category) {
    return ok(
            post(
                "/api/v1/rides/" + rideId + "/reports",
                Map.of("category", category, "photoFileIds", List.of()),
                reporter.token()),
            HttpStatus.CREATED)
        .get("id")
        .asText();
  }

  private List<String> ids(String query, String token) {
    JsonNode page = ok(get("/api/v1/admin/reports?" + query, token), HttpStatus.OK);
    List<String> ids = new ArrayList<>();
    page.get("items").forEach(item -> ids.add(item.get("id").asText()));
    assertThat(page.get("totalElements").asInt()).isEqualTo(ids.size());
    return ids;
  }

  @Test
  @DisplayName("reporterUserId lists the reports the user filed, both sides, per status")
  void shouldListReportsMadeByTheUser() {
    Account samer = newDriver(); // holds rider + driver roles
    Account rana = newRider();
    Account other = newRider();
    UUID asDriver = completedRide(rana.userId(), samer.userId(), CLOCK.instant());
    UUID asRider = completedRide(samer.userId(), newDriver().userId(), CLOCK.instant());
    UUID unrelated = completedRide(other.userId(), samer.userId(), CLOCK.instant());
    String damage = file(samer, asDriver, "other");
    String unsafe = file(samer, asRider, "unsafe_driving");
    String against = file(other, unrelated, "inappropriate_behavior"); // about samer, not by him

    String support = supportAdmin("+963937650031");
    assertThat(ids("reporterUserId=" + samer.userId(), support))
        .containsExactlyInAnyOrder(damage, unsafe);
    JsonNode row =
        ok(get("/api/v1/admin/reports?reporterUserId=" + samer.userId(), support), HttpStatus.OK)
            .get("items")
            .get(0);
    assertThat(row.get("status").asText()).isEqualTo("open");
    assertThat(row.get("reporter").get("userId").asText()).isEqualTo(samer.userId().toString());
    assertThat(row.get("rideId").isTextual()).isTrue();

    ok(
        post(
            "/api/v1/admin/reports/" + unsafe + "/resolve",
            Map.of("outcome", "substantiated", "note", "Checked"),
            admin),
        HttpStatus.OK);
    assertThat(ids("reporterUserId=" + samer.userId(), support)).containsExactly(damage);
    assertThat(ids("status=substantiated&reporterUserId=" + samer.userId(), support))
        .containsExactly(unsafe);
    // Combines with reportedUserId; the reported-user filter alone is unchanged.
    assertThat(
            ids("reporterUserId=" + samer.userId() + "&reportedUserId=" + rana.userId(), support))
        .containsExactly(damage);
    assertThat(ids("reportedUserId=" + samer.userId(), support)).containsExactly(against);
    assertThat(ids("reporterUserId=" + rana.userId(), support)).isEmpty();
  }

  @Test
  @DisplayName("the reporter filter needs reports:view like the queue")
  void shouldGateTheReporterFilter() {
    Account rider = newRider();
    String powerless = powerlessAdmin("+963937650032");
    assertThat(
            get("/api/v1/admin/reports?reporterUserId=" + rider.userId(), powerless)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/reports?reporterUserId=not-a-uuid", admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }
}
