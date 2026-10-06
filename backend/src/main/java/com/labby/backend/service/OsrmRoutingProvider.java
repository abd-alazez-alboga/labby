package com.labby.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.config.RoutingProperties;
import com.labby.backend.dto.LatLngDto;
import com.labby.backend.dto.RouteDto;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * {@link RoutingProvider} over OSRM's HTTP API (ES-04): the public demo server in V1 ({@code
 * ROUTING_OSRM_URL}), driving profile, full-overview GeoJSON geometry, bounded by {@code
 * ROUTING_OSRM_TIMEOUT_SECONDS}. Any failure — unreachable, timeout, HTTP error, non-{@code Ok}
 * code, unparseable body — falls back to a straight-line estimate (great-circle distance × detour
 * factor at the fallback speed) flagged approximate, never a hard failure (NFR-A3).
 */
@Slf4j
@Service
public class OsrmRoutingProvider implements RoutingProvider {

  private static final double EARTH_RADIUS_METERS = 6_371_008.8;

  private final RestClient restClient;
  private final String baseUrl;
  private final double detourFactor;
  private final double fallbackSpeedMps;

  public OsrmRoutingProvider(RoutingProperties properties, RestClient.Builder restClientBuilder) {
    Duration timeout = Duration.ofSeconds(properties.osrmTimeoutSeconds());
    JdkClientHttpRequestFactory requestFactory =
        new JdkClientHttpRequestFactory(
            // HTTP/1.1 pinned: the public OSRM server stalls JDK HTTP/2 requests until the timeout
            // (verified 2026-10-06), which silently turned every route into the fallback.
            HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(timeout)
                .build());
    requestFactory.setReadTimeout(timeout);
    this.restClient = restClientBuilder.clone().requestFactory(requestFactory).build();
    this.baseUrl = properties.osrmUrl().replaceAll("/+$", "");
    this.detourFactor = properties.fallbackDetourFactor();
    this.fallbackSpeedMps = properties.fallbackSpeedKmh() / 3.6;
  }

  @Override
  public RouteDto route(List<LatLngDto> points) {
    try {
      JsonNode body = restClient.get().uri(routeUri(points)).retrieve().body(JsonNode.class);
      if (body == null || !"Ok".equals(body.path("code").asText())) {
        log.warn(
            "OSRM answered without a route ({}); using the straight-line estimate",
            body == null ? "empty body" : body.path("code").asText());
        return straightLine(points);
      }
      JsonNode route = body.path("routes").path(0);
      List<double[]> geometry = new ArrayList<>();
      for (JsonNode coordinate : route.path("geometry").path("coordinates")) {
        geometry.add(new double[] {coordinate.path(0).asDouble(), coordinate.path(1).asDouble()});
      }
      if (route.isMissingNode() || geometry.size() < 2) {
        log.warn("OSRM route had no geometry; using the straight-line estimate");
        return straightLine(points);
      }
      return new RouteDto(
          Math.round(route.path("distance").asDouble()),
          Math.round(route.path("duration").asDouble()),
          geometry,
          false);
    } catch (RuntimeException ex) {
      log.warn(
          "OSRM unavailable ({}); using the straight-line estimate", ex.getClass().getSimpleName());
      return straightLine(points);
    }
  }

  private URI routeUri(List<LatLngDto> points) {
    String coordinates =
        points.stream()
            .map(point -> String.format(Locale.ROOT, "%.6f,%.6f", point.lng(), point.lat()))
            .collect(Collectors.joining(";"));
    return URI.create(
        baseUrl + "/route/v1/driving/" + coordinates + "?overview=full&geometries=geojson");
  }

  /** The straight-line fallback: great-circle legs × detour factor at the fallback speed. */
  RouteDto straightLine(List<LatLngDto> points) {
    double meters = 0;
    List<double[]> geometry = new ArrayList<>();
    for (int i = 0; i < points.size(); i++) {
      LatLngDto point = points.get(i);
      geometry.add(new double[] {point.lng(), point.lat()});
      if (i > 0) {
        meters += greatCircleMeters(points.get(i - 1), point);
      }
    }
    double distance = meters * detourFactor;
    return new RouteDto(
        Math.round(distance), Math.round(distance / fallbackSpeedMps), geometry, true);
  }

  /**
   * Haversine distance.
   *
   * @param from a point
   * @param to another point
   * @return metres along the great circle
   */
  static double greatCircleMeters(LatLngDto from, LatLngDto to) {
    double lat1 = Math.toRadians(from.lat());
    double lat2 = Math.toRadians(to.lat());
    double deltaLat = lat2 - lat1;
    double deltaLng = Math.toRadians(to.lng() - from.lng());
    double a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2)
            + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
  }
}
