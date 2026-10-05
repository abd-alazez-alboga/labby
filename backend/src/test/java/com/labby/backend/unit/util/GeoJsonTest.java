package com.labby.backend.unit.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.dto.GeoJsonPolygonDto;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.util.GeoJson;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.locationtech.jts.geom.Polygon;

/** GeoJSON edge validation: lng/lat order, closed outer ring, no holes, polite 400s. */
class GeoJsonTest {

  private static final List<List<Double>> RING =
      List.of(
          List.of(36.0, 33.0),
          List.of(36.5, 33.0),
          List.of(36.5, 33.5),
          List.of(36.0, 33.5),
          List.of(36.0, 33.0));

  @Test
  @DisplayName("a valid polygon round-trips dto -> JTS -> dto with SRID 4326")
  void shouldRoundTripValidPolygon() {
    Polygon polygon = GeoJson.toPolygon(new GeoJsonPolygonDto("Polygon", List.of(RING)));

    assertThat(polygon.getSRID()).isEqualTo(4326);
    assertThat(polygon.getExteriorRing().getNumPoints()).isEqualTo(5);
    // Lng/lat order: x is longitude.
    assertThat(polygon.getExteriorRing().getCoordinateN(1).x).isEqualTo(36.5);
    assertThat(GeoJson.toDto(polygon)).isEqualTo(new GeoJsonPolygonDto("Polygon", List.of(RING)));
  }

  @Test
  @DisplayName("null maps to null in both directions")
  void shouldMapNullToNull() {
    assertThat(GeoJson.toPolygon(null)).isNull();
    assertThat(GeoJson.toDto(null)).isNull();
    assertThat(GeoJson.compact(null)).isNull();
  }

  @Test
  @DisplayName("holes are rejected politely with 400")
  void shouldRejectHoles() {
    List<List<Double>> hole =
        List.of(List.of(36.1, 33.1), List.of(36.2, 33.1), List.of(36.2, 33.2), List.of(36.1, 33.1));

    assertThatThrownBy(
            () -> GeoJson.toPolygon(new GeoJsonPolygonDto("Polygon", List.of(RING, hole))))
        .isInstanceOf(InvalidRequestException.class)
        .hasMessageContaining("holes");
  }

  @Test
  @DisplayName("an open outer ring is rejected")
  void shouldRejectOpenRing() {
    List<List<Double>> open =
        List.of(List.of(36.0, 33.0), List.of(36.5, 33.0), List.of(36.5, 33.5), List.of(36.0, 33.5));

    assertThatThrownBy(() -> GeoJson.toPolygon(new GeoJsonPolygonDto("Polygon", List.of(open))))
        .isInstanceOf(InvalidRequestException.class)
        .hasMessageContaining("closed");
  }

  @Test
  @DisplayName("wrong geometry type, missing coordinates, and bad positions are rejected")
  void shouldRejectMalformedShapes() {
    assertThatThrownBy(() -> GeoJson.toPolygon(new GeoJsonPolygonDto("Point", List.of(RING))))
        .isInstanceOf(InvalidRequestException.class);
    assertThatThrownBy(() -> GeoJson.toPolygon(new GeoJsonPolygonDto("Polygon", null)))
        .isInstanceOf(InvalidRequestException.class);
    assertThatThrownBy(() -> GeoJson.toPolygon(new GeoJsonPolygonDto("Polygon", List.of())))
        .isInstanceOf(InvalidRequestException.class);
    assertThatThrownBy(
            () ->
                GeoJson.toPolygon(
                    new GeoJsonPolygonDto(
                        "Polygon",
                        List.of(
                            List.of(
                                List.of(36.0, 33.0, 1.0),
                                List.of(36.5, 33.0),
                                List.of(36.5, 33.5),
                                List.of(36.0, 33.0))))))
        .isInstanceOf(InvalidRequestException.class);
  }

  @Test
  @DisplayName("out-of-range coordinates are rejected (lng beyond 180, lat beyond 90)")
  void shouldRejectOutOfRangeCoordinates() {
    List<List<Double>> badLat =
        List.of(List.of(36.0, 91.0), List.of(36.5, 33.0), List.of(36.5, 33.5), List.of(36.0, 91.0));

    assertThatThrownBy(() -> GeoJson.toPolygon(new GeoJsonPolygonDto("Polygon", List.of(badLat))))
        .isInstanceOf(InvalidRequestException.class)
        .hasMessageContaining("lat");
  }

  @Test
  @DisplayName("the compact audit form carries vertex count and bbox, not every coordinate")
  void shouldSummarizeCompactly() {
    Polygon polygon = GeoJson.toPolygon(new GeoJsonPolygonDto("Polygon", List.of(RING)));

    assertThat(GeoJson.compact(polygon)).contains("vertices=5").contains("bbox=");
  }
}
