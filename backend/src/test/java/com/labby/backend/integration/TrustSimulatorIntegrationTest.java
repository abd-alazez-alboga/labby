package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.MetricWarningJob;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.PushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

/**
 * M11-T5 acceptance — the trust walkthrough, scripted on a controlled clock through the real HTTP
 * API: real rides (book → dispatch → accept → arrive → start → complete) with seeded fixtures only
 * where the scenario says "seeded"; the daily snapshot job and the DRV-07 job are invoked at the
 * scripted moments; notifications go through the real outbox dispatcher to the notification center
 * and a captured push. Four scenarios: (1) both parties rate → exposed aggregates move only with
 * the snapshot job while the admin live average moves at once; (2) a seeded driver at the threshold
 * edge is auto-suspended by one more real low rating, notified, kept offline and out of dispatch,
 * reactivated by an admin and re-suspended by the next low rating; (3) reports with photo evidence,
 * substantiated 3 times over time → the report_threshold flag, no suspension, the reporter told the
 * outcome only; (4) a seeded high-cancel driver → the metric warning (push, dashboard, flag), never
 * a suspension, cleared on recovery.
 */
class TrustSimulatorIntegrationTest extends AbstractTrustIntegrationTest {

  private static final int ETA = 300;

  @MockitoBean private PushSender pushSender;

  @Autowired private NotificationDispatchService notificationDispatchService;
  @Autowired private MetricWarningJob metricWarningJob;

  private final List<PushMessage> pushes = new CopyOnWriteArrayList<>();
  private int devices;

  @BeforeEach
  void capturePushes() {
    pushes.clear();
    Mockito.reset(pushSender);
    when(pushSender.send(anyList(), any()))
        .thenAnswer(
            invocation -> {
              pushes.add(invocation.getArgument(1));
              return new PushResult(invocation.<List<?>>getArgument(0).size(), Set.of());
            });
  }

  // ---- 1. ride -> both rate -> aggregates move ------------------------------------------------

  @Test
  @DisplayName(
      "RATE-01/02: real rides, both sides rate; the exposed averages move only with the daily job,"
          + " the admin live average at once; history myRating flips")
  void shouldMoveAggregatesOnlyWithTheSnapshotJob() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    int[] riderGives = {5, 4, 5, 4};
    int[] driverGives = {5, 5, 5, 5};
    for (int i = 0; i < 4; i++) {
      UUID rideId = completeRide(rider, driver, "cash");
      rateOk(rider, rideId, riderGives[i]);
      rateOk(driver, rideId, driverGives[i]);
      position(driver, PICKUP_LAT, PICKUP_LNG);
    }
    ratingSnapshotJob.run();
    // 4 ratings: below the exposure minimum on both sides.
    assertThat(own(driver, "driver").get("average").isNull()).isTrue();
    assertThat(own(driver, "driver").has("ratingCount")).isFalse();
    assertThat(own(rider, "rider").get("average").isNull()).isTrue();

    UUID fifth = completeRide(rider, driver, "cash");
    assertThat(historyRow("/api/v1/rides", rider, fifth).get("myRating").get("state").asText())
        .isEqualTo("pending");
    rateOk(rider, fifth, 5); // driver: 23 / 5 = 4.60
    rateOk(driver, fifth, 4); // rider: 24 / 5 = 4.80
    assertThat(historyRow("/api/v1/rides", rider, fifth).get("myRating").get("state").asText())
        .isEqualTo("submitted");
    assertThat(
            historyRow("/api/v1/driver/rides", driver, fifth).get("myRating").get("score").asInt())
        .isEqualTo(4);
    // The admin live average moves at once; what the users see does not.
    assertThat(liveAverage(driver, "driver")).isEqualByComparingTo("4.60");
    assertThat(liveAverage(rider, "rider")).isEqualByComparingTo("4.80");
    assertThat(own(driver, "driver").get("average").isNull()).isTrue();
    assertThat(riderRide(rider, fifth).get("driver").get("rating").isNull()).isTrue();

    // The next day's job: now the exposed views carry the averages.
    advance(Duration.ofDays(1));
    ratingSnapshotJob.run();
    assertThat(own(driver, "driver").get("average").decimalValue()).isEqualByComparingTo("4.60");
    assertThat(own(rider, "rider").get("average").decimalValue()).isEqualByComparingTo("4.80");
    // The offer summary the driver sees, then the driver card the rider sees.
    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID sixth = book(rider);
    dispatch();
    JsonNode offer = openOffer(driver);
    assertThat(offer.get("rider").get("rating").decimalValue()).isEqualByComparingTo("4.80");
    ok(accept(driver, offer.get("id").asText()), HttpStatus.OK);
    assertThat(riderRide(rider, sixth).get("driver").get("rating").decimalValue())
        .isEqualByComparingTo("4.60");
    assertThat(riderRide(rider, sixth).get("myRating").get("state").asText())
        .isEqualTo("not_applicable");
    // Every completed ride was rated: nothing is pending.
    assertThat(ok(get("/api/v1/ratings/pending?as=rider", rider.token()), HttpStatus.OK)).isEmpty();
  }

  // ---- 2. auto-suspension -> notification -> reactivation -> re-suspension ---------------------

  @Test
  @DisplayName(
      "USR-05: a seeded driver at the edge, one more real low rating -> low_rating suspension with"
          + " the rule pushed; offline and out of dispatch; admin reactivates; next one re-fires")
  void shouldAutoSuspendNotifyReactivateAndReFire() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    registerDevice(driver, "driver");
    Account seeder = newRider();
    driverRatedTimes(seeder, driver, 19, 3); // seeded: 19 ratings averaging exactly 3.0
    Account rider = rider();

    UUID rideId = completeRide(rider, driver, "cash");
    rateOk(rider, rideId, 1); // 58 / 20 = 2.90 < 3.0 with the 20-ride minimum reached
    // Never on the rating itself (review B-H1): the night's pass suspends.
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    ratingSnapshotJob.run();
    assertThat(roleRow(driver.userId(), "driver").get("suspension_reason")).isEqualTo("low_rating");
    notificationDispatchService.dispatchPending();
    JsonNode notice = latestNotification(driver, "driver", "account.role_suspended");
    assertThat(notice.get("title").asText()).isEqualTo("Driver account suspended");
    assertThat(notice.get("body").asText())
        .isEqualTo(
            "Your driver account is suspended because your average rating is below 3 after 20"
                + " rated rides.");
    assertThat(pushes)
        .anySatisfy(
            push -> {
              assertThat(push.data()).containsEntry("event", "account.role_suspended");
              assertThat(push.title()).isEqualTo("Driver account suspended");
            });
    assertThat(flags(driver.userId())).extracting(flag -> flag.get("kind")).contains("low_rating");

    // Offline at once (no ride in flight), refused going online, never offered a new ride.
    JsonNode availability = ok(get("/api/v1/driver/availability", driver.token()), HttpStatus.OK);
    assertThat(availability.get("online").asBoolean()).isFalse();
    assertThat(availability.get("canGoOnline").asBoolean()).isFalse();
    assertThat(availability.get("suspensionReason").asText()).isEqualTo("low_rating");
    assertThat(
            put("/api/v1/driver/availability", Map.of("online", true), driver.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    UUID waiting = book(rider);
    dispatch();
    assertThat(hasOpenOffer(driver)).isFalse();
    // The only nearby driver is suspended: the request finds nobody.
    assertThat(stateOf(waiting)).isEqualTo("no_driver_found");

    // The admin reactivates (audited); the driver is back online.
    JsonNode trust =
        ok(
            post(
                "/api/v1/admin/users/" + driver.userId() + "/roles/driver/reactivate",
                Map.of("note", "Coaching done"),
                admin),
            HttpStatus.OK);
    assertThat(TrustRatingsIntegrationTest.roleTrust(trust, "driver").get("state").asText())
        .isEqualTo("active");
    assertThat(auditActions(driver.userId().toString())).contains("user.role_reactivate");
    notificationDispatchService.dispatchPending();
    assertThat(
            latestNotification(driver, "driver", "account.role_reactivated").get("body").asText())
        .contains("Coaching done");
    ok(put("/api/v1/driver/availability", Map.of("online", true), driver.token()), HttpStatus.OK);
    position(driver, PICKUP_LAT, PICKUP_LNG);

    // The next real low rating re-suspends (60 / 21 = 2.86).
    UUID next = completeRide(rider, driver, "cash");
    rateOk(rider, next, 2);
    ratingSnapshotJob.run();
    assertThat(roleRow(driver.userId(), "driver").get("suspension_reason")).isEqualTo("low_rating");
    assertThat(outboxParams(driver.userId(), "account.role_suspended")).hasSize(2);
  }

  // ---- 3. reports with evidence -> substantiate x3 -> flag -------------------------------------

  @Test
  @DisplayName(
      "REP-01..03: reports with photo evidence, substantiated 3 times over 61 days -> one"
          + " report_threshold flag, no suspension; the reporter sees the outcome only")
  void shouldFlagTheThirdSubstantiatedReport() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    String[] reportIds = new String[3];
    Account firstReporter = null;
    for (int i = 0; i < 3; i++) {
      Account rider = rider();
      if (i == 0) {
        firstReporter = rider;
        registerDevice(rider, "rider");
      }
      position(driver, PICKUP_LAT, PICKUP_LNG);
      UUID rideId = completeRide(rider, driver, "cash");
      UUID photo = uploadPhoto(rider);
      Map<String, Object> body =
          Map.of(
              "category",
              "unsafe_driving",
              "description",
              "Speeding on the highway",
              "photoFileIds",
              List.of(photo.toString()));
      reportIds[i] =
          ok(post("/api/v1/rides/" + rideId + "/reports", body, rider.token()), HttpStatus.CREATED)
              .get("id")
              .asText();
    }
    String support = supportAdmin("+963937650051");
    JsonNode detail = ok(get("/api/v1/admin/reports/" + reportIds[0], support), HttpStatus.OK);
    assertThat(detail.get("photoUrls")).hasSize(1);
    assertThat(detail.get("description").asText()).isEqualTo("Speeding on the highway");

    resolve(support, reportIds[0], "Dashcam confirms");
    assertThat(flags(driver.userId())).isEmpty();
    advance(Duration.ofDays(30));
    resolve(support, reportIds[1], "Second witness");
    assertThat(flags(driver.userId())).isEmpty();
    advance(Duration.ofDays(31));
    resolve(support, reportIds[2], "Pattern confirmed");

    JsonNode queue = ok(get("/api/v1/admin/flags?kind=report_threshold", support), HttpStatus.OK);
    assertThat(queue.get("totalElements").asInt()).isEqualTo(1);
    JsonNode flag = queue.get("items").get(0);
    assertThat(flag.get("user").get("userId").asText()).isEqualTo(driver.userId().toString());
    assertThat(flag.get("user").get("role").asText()).isEqualTo("driver");
    JsonNode details = flag.get("details");
    assertThat(details.get("substantiatedCount").asInt()).isEqualTo(3);
    assertThat(details.get("threshold").asInt()).isEqualTo(3);
    assertThat(details.get("windowDays").asInt()).isEqualTo(90);
    assertThat(details.get("reportIds")).extracting(JsonNode::asText).containsExactly(reportIds);
    // Flag only.
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");

    // The reporter: outcome only, in the list and in the notification.
    JsonNode mine = ok(get("/api/v1/reports/mine?as=rider", firstReporter.token()), HttpStatus.OK);
    assertThat(mine.get("items").get(0).get("status").asText()).isEqualTo("substantiated");
    assertThat(mine.toString()).doesNotContain("Dashcam");
    notificationDispatchService.dispatchPending();
    JsonNode outcome = latestNotification(firstReporter, "rider", "report.resolved");
    assertThat(outcome.get("body").asText())
        .isEqualTo(
            "We reviewed your report and confirmed it. Thank you for helping keep Labby safe.");
    assertThat(pushes).noneMatch(push -> push.body().contains("Dashcam"));
    // The reported driver is never told.
    assertThat(outboxEvents(driver.userId())).noneMatch(event -> event.startsWith("report."));
  }

  // ---- 4. high-cancel driver -> metric warning -> recovery -------------------------------------

  @Test
  @DisplayName(
      "DRV-07: a seeded high-cancel driver -> the job raises the warning (push, dashboard, flag),"
          + " never a suspension; recovery clears it on the next run")
  void shouldWarnAHighCancelDriverAndClearOnRecovery() {
    Account driver = newDriver();
    registerDevice(driver, "driver");
    Account rider = newRider();
    Instant day = CLOCK.instant().minus(Duration.ofDays(3));
    for (int i = 0; i < 16; i++) {
      acceptedRide(rider, driver, "completed", day);
    }
    for (int i = 0; i < 4; i++) {
      acceptedRide(rider, driver, "cancelled_by_driver", day); // 4 / 20 = 20% > 15%
    }

    metricWarningJob.run();
    JsonNode dashboard = ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK);
    assertThat(dashboard.get("warnings")).hasSize(1);
    JsonNode warning = dashboard.get("warnings").get(0);
    assertThat(warning.get("metric").asText()).isEqualTo("cancellation");
    assertThat(warning.get("comparison").asText()).isEqualTo("above");
    assertThat(warning.get("valuePercent").decimalValue()).isEqualByComparingTo("20");
    assertThat(warning.get("thresholdPercent").decimalValue()).isEqualByComparingTo("15");
    assertPercentage(dashboard.get("windows").get(1).get("cancellation"), 4, 20);
    notificationDispatchService.dispatchPending();
    assertThat(latestNotification(driver, "driver", "driver.metric_warning").get("body").asText())
        .isEqualTo(
            "Your cancellation rate for the last 30 days is 20%, above the 15% maximum. Try to"
                + " cancel fewer accepted rides.");
    assertThat(pushes)
        .anySatisfy(push -> assertThat(push.title()).isEqualTo("Your cancellation rate is high"));
    JsonNode flagQueue = ok(get("/api/v1/admin/flags?kind=metric_warning", admin), HttpStatus.OK);
    assertThat(flagQueue.get("totalElements").asInt()).isEqualTo(1);
    assertThat(flagQueue.get("items").get(0).get("details").get("sampleSize").asInt())
        .isEqualTo(20);
    // Warn only.
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    assertThat(outboxParams(driver.userId(), "account.role_suspended")).isEmpty();
    // The job running again while the breach holds changes nothing.
    metricWarningJob.run();
    assertThat(outboxParams(driver.userId(), "driver.metric_warning")).hasSize(1);

    // Recovery: 7 more completed rides -> 4 / 27 = 14.8% -> the next run clears the warning.
    for (int i = 0; i < 7; i++) {
      acceptedRide(rider, driver, "completed", day);
    }
    metricWarningJob.run();
    assertThat(ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK).get("warnings"))
        .isEmpty();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT cleared_at IS NOT NULL FROM driver_metric_warnings WHERE driver_user_id = ?",
                Boolean.class,
                driver.userId()))
        .isTrue();
  }

  // ---- helpers -------------------------------------------------------------------------------

  private JsonNode own(Account account, String role) {
    for (JsonNode entry : ok(get("/api/v1/users/me/ratings", account.token()), HttpStatus.OK)) {
      if (role.equals(entry.get("role").asText())) {
        return entry;
      }
    }
    throw new AssertionError("no " + role + " aggregate");
  }

  private java.math.BigDecimal liveAverage(Account account, String role) {
    JsonNode trust =
        ok(get("/api/v1/admin/users/" + account.userId() + "/trust", admin), HttpStatus.OK);
    return TrustRatingsIntegrationTest.roleTrust(trust, role).get("liveAverage").decimalValue();
  }

  private JsonNode historyRow(String url, Account account, UUID rideId) {
    for (JsonNode item : ok(get(url + "?size=50", account.token()), HttpStatus.OK).get("items")) {
      if (rideId.toString().equals(item.get("id").asText())) {
        return item;
      }
    }
    throw new AssertionError("ride " + rideId + " not in history");
  }

  private JsonNode latestNotification(Account account, String app, String event) {
    for (JsonNode item :
        ok(get("/api/v1/notifications?app=" + app, account.token()), HttpStatus.OK).get("items")) {
      if (event.equals(item.get("event").asText())) {
        return item;
      }
    }
    throw new AssertionError("no " + event + " in the " + app + " notification center");
  }

  private void registerDevice(Account account, String app) {
    HttpHeaders headers = bearer(account.token());
    headers.setContentType(MediaType.APPLICATION_JSON);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/devices",
                    HttpMethod.PUT,
                    new HttpEntity<>(
                        Map.of(
                            "token", "fcm-trust-" + (++devices), "platform", "android", "app", app),
                        headers),
                    JsonNode.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
  }

  private void resolve(String adminToken, String reportId, String note) {
    ok(
        post(
            "/api/v1/admin/reports/" + reportId + "/resolve",
            Map.of("outcome", "substantiated", "note", note),
            adminToken),
        HttpStatus.OK);
  }

  private UUID uploadPhoto(Account account) {
    MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
    HttpHeaders partHeaders = new HttpHeaders();
    partHeaders.setContentType(MediaType.IMAGE_JPEG);
    body.add(
        "file",
        new HttpEntity<>(
            new ByteArrayResource(JPEG) {
              @Override
              public String getFilename() {
                return "evidence.jpg";
              }
            },
            partHeaders));
    HttpHeaders headers = bearer(account.token());
    headers.setContentType(MediaType.MULTIPART_FORM_DATA);
    ResponseEntity<JsonNode> response =
        restTemplate.exchange(
            "/api/v1/report-files",
            HttpMethod.POST,
            new HttpEntity<>(body, headers),
            JsonNode.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    return UUID.fromString(response.getBody().get("fileId").asText());
  }

  /** A seeded ride the driver accepted through an accepted offer (arrived on time if it did). */
  private void acceptedRide(Account rider, Account driver, String state, Instant acceptedAt) {
    boolean completed = "completed".equals(state);
    UUID rideId =
        ride(
            rider.userId(),
            driver.userId(),
            state,
            acceptedAt,
            completed ? acceptedAt.plusSeconds(120) : null,
            completed ? acceptedAt.plusSeconds(1800) : null,
            completed ? null : acceptedAt.plusSeconds(60));
    offer(rideId, driver.userId(), acceptedAt.minusSeconds(10), "accepted", ETA);
  }

  private static void assertPercentage(JsonNode percentage, int numerator, int denominator) {
    assertThat(percentage.get("numerator").asInt()).isEqualTo(numerator);
    assertThat(percentage.get("denominator").asInt()).isEqualTo(denominator);
  }
}
