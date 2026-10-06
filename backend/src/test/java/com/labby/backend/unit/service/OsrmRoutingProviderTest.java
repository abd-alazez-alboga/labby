package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.config.RoutingProperties;
import com.labby.backend.dto.LatLngDto;
import com.labby.backend.dto.RouteDto;
import com.labby.backend.service.OsrmRoutingProvider;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

/**
 * ES-04 / NFR-A3 against a LOCAL stub OSRM (never the public server): a real route is parsed, and
 * every failure mode — HTTP 500, a hang past the timeout, a non-Ok code, a refused connection —
 * falls back to the straight-line estimate flagged approximate.
 */
class OsrmRoutingProviderTest {

  private static final LatLngDto UMAYYAD_SQUARE = new LatLngDto(33.5130, 36.2765);
  private static final LatLngDto BAB_TOUMA = new LatLngDto(33.5146, 36.3165);
  private static final List<LatLngDto> POINTS = List.of(UMAYYAD_SQUARE, BAB_TOUMA);

  private HttpServer server;
  private final AtomicReference<String> lastRequest = new AtomicReference<>();

  @AfterEach
  void stopServer() {
    if (server != null) {
      server.stop(0);
    }
  }

  private String stub(int status, String body, Duration delay) throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setExecutor(Executors.newCachedThreadPool());
    server.createContext(
        "/",
        exchange -> {
          lastRequest.set(exchange.getRequestURI().toString());
          try {
            Thread.sleep(delay.toMillis());
          } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
          }
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "application/json");
          exchange.sendResponseHeaders(status, bytes.length);
          try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
          }
        });
    server.start();
    return "http://127.0.0.1:" + server.getAddress().getPort() + "/";
  }

  private static OsrmRoutingProvider provider(String url, int timeoutSeconds) {
    return new OsrmRoutingProvider(
        new RoutingProperties(url, timeoutSeconds, 1.3, 25), RestClient.builder());
  }

  @Test
  @DisplayName("an Ok OSRM answer is returned as-is: driving profile, full GeoJSON, [lng,lat]")
  void shouldParseOsrmRoute() throws IOException {
    String url =
        stub(
            200,
            """
            {"code":"Ok","routes":[{"distance":4321.6,"duration":612.4,
              "geometry":{"type":"LineString",
                "coordinates":[[36.2765,33.513],[36.29,33.514],[36.3165,33.5146]]}}]}
            """,
            Duration.ZERO);

    RouteDto route = provider(url, 3).route(POINTS);

    assertThat(route.approximate()).isFalse();
    assertThat(route.distanceMeters()).isEqualTo(4322);
    assertThat(route.durationSeconds()).isEqualTo(612);
    assertThat(route.geometry()).hasSize(3);
    assertThat(route.geometry().get(0)).containsExactly(36.2765, 33.513);
    assertThat(lastRequest.get())
        .isEqualTo(
            "/route/v1/driving/36.276500,33.513000;36.316500,33.514600"
                + "?overview=full&geometries=geojson");
  }

  @Test
  @DisplayName("HTTP 500 → straight-line fallback flagged approximate")
  void shouldFallBackOnServerError() throws IOException {
    RouteDto route = provider(stub(500, "{}", Duration.ZERO), 3).route(POINTS);
    assertStraightLine(route);
  }

  @Test
  @DisplayName("a non-Ok code (e.g. NoRoute) → fallback")
  void shouldFallBackOnNoRoute() throws IOException {
    RouteDto route =
        provider(stub(200, "{\"code\":\"NoRoute\",\"routes\":[]}", Duration.ZERO), 3).route(POINTS);
    assertStraightLine(route);
  }

  @Test
  @DisplayName("a hanging OSRM is abandoned at the timeout → fallback")
  void shouldFallBackOnTimeout() throws IOException {
    String url = stub(200, "{\"code\":\"Ok\"}", Duration.ofSeconds(5));
    long started = System.nanoTime();
    RouteDto route = provider(url, 1).route(POINTS);
    assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(3));
    assertStraightLine(route);
  }

  @Test
  @DisplayName("an unreachable OSRM → fallback")
  void shouldFallBackWhenUnreachable() {
    assertStraightLine(provider("http://127.0.0.1:9", 3).route(POINTS));
  }

  @Test
  @DisplayName("fallback math: great circle × 1.3 at 25 km/h over every leg")
  void shouldComputeTheStraightLineEstimate() {
    RouteDto route =
        provider("http://127.0.0.1:9", 3)
            .route(
                List.of(new LatLngDto(0.0, 0.0), new LatLngDto(0.0, 1.0), new LatLngDto(1.0, 1.0)));
    // One degree of arc on the mean-radius sphere is 111,195 m; two legs × 1.3.
    assertThat(route.distanceMeters()).isBetween(289_100L, 289_120L);
    assertThat(route.durationSeconds()).isEqualTo(Math.round(route.distanceMeters() / (25 / 3.6)));
    assertThat(route.geometry()).hasSize(3);
    assertThat(route.geometry().get(2)).containsExactly(1.0, 1.0);
  }

  private static void assertStraightLine(RouteDto route) {
    assertThat(route.approximate()).isTrue();
    // ~3.7 km great circle between the two Damascus points, × 1.3.
    assertThat(route.distanceMeters()).isBetween(4_700L, 4_900L);
    assertThat(route.geometry()).hasSize(2);
    assertThat(route.geometry().get(0)).containsExactly(36.2765, 33.5130);
  }
}
