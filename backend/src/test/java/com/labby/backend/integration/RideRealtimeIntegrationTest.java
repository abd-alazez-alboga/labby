package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;

/**
 * M7-T2 acceptance — ride events on the realtime socket (rides-v1.yaml, RIDE-02 "pushed to both
 * parties", TRK-02): every frame goes through Postgres NOTIFY after commit and is delivered by the
 * LISTENing instance to the account's sockets ({@code ride.state} with {@code as}, {@code
 * offer.new}, {@code offer.withdrawn}, {@code ride.driver_position}).
 */
class RideRealtimeIntegrationTest extends AbstractRideIntegrationTest {

  private static final long FRAME_WAIT_MS = 5000;

  @LocalServerPort private int port;
  @Autowired private ObjectMapper objectMapper;

  private final HttpClient httpClient = HttpClient.newHttpClient();
  private final List<WebSocket> sockets = new ArrayList<>();

  @AfterEach
  void closeSockets() {
    sockets.forEach(WebSocket::abort);
    sockets.clear();
  }

  /** An authenticated socket collecting every frame. */
  private BlockingQueue<JsonNode> connect(Account account) throws Exception {
    BlockingQueue<JsonNode> frames = new LinkedBlockingQueue<>();
    WebSocket socket =
        httpClient
            .newWebSocketBuilder()
            .buildAsync(
                URI.create("ws://localhost:" + port + "/api/v1/realtime"),
                new WebSocket.Listener() {
                  private final StringBuilder partial = new StringBuilder();

                  @Override
                  public CompletionStage<?> onText(
                      WebSocket webSocket, CharSequence data, boolean last) {
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
                })
            .join();
    sockets.add(socket);
    socket
        .sendText(
            objectMapper.writeValueAsString(Map.of("type", "auth", "token", account.token())), true)
        .get(5, TimeUnit.SECONDS);
    assertThat(next(frames, "ready").get("userId").asText()).isEqualTo(account.userId().toString());
    return frames;
  }

  /** The next frame of the given type (other frames are skipped). */
  private static JsonNode next(BlockingQueue<JsonNode> frames, String type) throws Exception {
    long deadline = System.currentTimeMillis() + FRAME_WAIT_MS;
    while (System.currentTimeMillis() < deadline) {
      JsonNode frame = frames.poll(deadline - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
      if (frame != null && type.equals(frame.path("type").asText())) {
        return frame;
      }
    }
    throw new AssertionError("no " + type + " frame within " + FRAME_WAIT_MS + " ms");
  }

  private static JsonNode nextState(BlockingQueue<JsonNode> frames, String state) throws Exception {
    long deadline = System.currentTimeMillis() + FRAME_WAIT_MS;
    while (System.currentTimeMillis() < deadline) {
      JsonNode frame = next(frames, "ride.state");
      if (state.equals(frame.get("ride").get("state").asText())) {
        return frame;
      }
    }
    throw new AssertionError("no ride.state " + state);
  }

  @Test
  @DisplayName("both parties receive every transition; the driver gets offers; the rider positions")
  void shouldStreamRideEventsToBothParties() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    BlockingQueue<JsonNode> riderFrames = connect(rider);
    BlockingQueue<JsonNode> driverFrames = connect(driver);

    UUID rideId = book(rider);
    JsonNode requested = nextState(riderFrames, "requested");
    assertThat(requested.get("as").asText()).isEqualTo("rider");
    assertThat(requested.get("ride").get("id").asText()).isEqualTo(rideId.toString());

    dispatch();
    JsonNode offer = next(driverFrames, "offer.new");
    assertThat(offer.get("as").asText()).isEqualTo("driver");
    assertThat(offer.get("offer").get("rideId").asText()).isEqualTo(rideId.toString());
    nextState(riderFrames, "offering");

    ok(accept(driver, offer.get("offer").get("id").asText()), HttpStatus.OK);
    JsonNode riderAccepted = nextState(riderFrames, "accepted");
    assertThat(riderAccepted.get("ride").get("driver").get("firstName").asText())
        .isEqualTo("Driver");
    JsonNode driverAccepted = nextState(driverFrames, "accepted");
    assertThat(driverAccepted.get("as").asText()).isEqualTo("driver");
    assertThat(driverAccepted.get("ride").get("rider").get("firstName").asText()).isEqualTo("Rana");
    assertThat(driverAccepted.get("ride").get("driver").isNull()).isTrue();

    // TRK-02: from acceptance every sample is relayed to the rider.
    position(driver, 33.5005, 36.30);
    JsonNode relayed = next(riderFrames, "ride.driver_position");
    assertThat(relayed.get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(relayed.get("lat").asDouble()).isEqualTo(33.5005);

    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);
    nextState(riderFrames, "driver_arrived");
    nextState(driverFrames, "driver_arrived");
  }

  @Test
  @DisplayName("driver cancel: the rider's cancelled frame already names the re-dispatched ride")
  void shouldNameRedispatchedRideInCancelFrame() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    BlockingQueue<JsonNode> riderFrames = connect(rider);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);

    ok(
        post(
            "/api/v1/driver/rides/" + rideId + "/cancel",
            Map.of("reason", "vehicle_issue"),
            driver.token()),
        HttpStatus.OK);
    JsonNode cancelled = nextState(riderFrames, "cancelled_by_driver");
    String newRideId = cancelled.get("ride").get("redispatchedAsRideId").asText();
    assertThat(newRideId).isNotBlank();
    JsonNode requested = nextState(riderFrames, "requested");
    assertThat(requested.get("ride").get("id").asText()).isEqualTo(newRideId);
    assertThat(requested.get("ride").get("redispatchOfRideId").asText())
        .isEqualTo(rideId.toString());
  }

  @Test
  @DisplayName("an open offer withdrawn by a rider cancel is announced to its driver")
  void shouldAnnounceWithdrawnOffer() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    BlockingQueue<JsonNode> driverFrames = connect(driver);
    UUID rideId = book(rider);
    dispatch();
    String offerId = next(driverFrames, "offer.new").get("offer").get("id").asText();

    ok(
        post(
            "/api/v1/rides/" + rideId + "/cancel", Map.of("reason", "changed_mind"), rider.token()),
        HttpStatus.OK);
    JsonNode withdrawn = next(driverFrames, "offer.withdrawn");
    assertThat(withdrawn.get("offerId").asText()).isEqualTo(offerId);
    assertThat(withdrawn.get("reason").asText()).isEqualTo("ride_ended");
  }
}
