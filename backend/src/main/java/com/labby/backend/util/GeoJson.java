package com.labby.backend.util;

import com.labby.backend.dto.GeoJsonPolygonDto;
import com.labby.backend.exception.InvalidRequestException;
import java.util.ArrayList;
import java.util.List;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Envelope;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Polygon;
import org.locationtech.jts.geom.PrecisionModel;

/**
 * GeoJSON ↔ JTS conversion at the API edge (regions-v1.yaml): polygons travel as GeoJSON in {@code
 * [lng, lat]} order, SRID 4326, single closed outer ring, no holes in V1. Structural problems map
 * to 400 via {@link InvalidRequestException}.
 */
public final class GeoJson {

  public static final String POLYGON_TYPE = "Polygon";

  private static final GeometryFactory GEOMETRY_FACTORY =
      new GeometryFactory(new PrecisionModel(), 4326);

  private GeoJson() {}

  /**
   * Parses and validates a GeoJSON polygon.
   *
   * @param dto the GeoJSON payload, or null
   * @return the JTS polygon (SRID 4326), or null for a null input
   * @throws InvalidRequestException on a wrong type, holes, an open or degenerate outer ring,
   *     malformed positions, out-of-range coordinates, or a self-intersecting ring
   */
  public static Polygon toPolygon(GeoJsonPolygonDto dto) {
    if (dto == null) {
      return null;
    }
    if (!POLYGON_TYPE.equals(dto.type())) {
      throw new InvalidRequestException("Geometry type must be 'Polygon'");
    }
    List<List<List<Double>>> rings = dto.coordinates();
    if (rings == null || rings.isEmpty()) {
      throw new InvalidRequestException("Polygon coordinates are required");
    }
    if (rings.size() > 1) {
      throw new InvalidRequestException(
          "Polygon holes are not supported in V1; send a single outer ring");
    }
    List<List<Double>> ring = rings.get(0);
    if (ring == null || ring.size() < 4) {
      throw new InvalidRequestException(
          "The outer ring needs at least 4 positions (closed: first == last)");
    }
    Coordinate[] coordinates = new Coordinate[ring.size()];
    for (int i = 0; i < ring.size(); i++) {
      List<Double> position = ring.get(i);
      if (position == null
          || position.size() != 2
          || position.get(0) == null
          || position.get(1) == null) {
        throw new InvalidRequestException("Each position must be a [lng, lat] pair");
      }
      double lng = position.get(0);
      double lat = position.get(1);
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        throw new InvalidRequestException(
            "Positions are [lng, lat]: lng within [-180, 180], lat within [-90, 90]");
      }
      coordinates[i] = new Coordinate(lng, lat);
    }
    if (!coordinates[0].equals2D(coordinates[coordinates.length - 1])) {
      throw new InvalidRequestException(
          "The outer ring must be closed (first point == last point)");
    }
    Polygon polygon = GEOMETRY_FACTORY.createPolygon(coordinates);
    if (!polygon.isValid()) {
      throw new InvalidRequestException("The polygon is not valid (it may self-intersect)");
    }
    return polygon;
  }

  /**
   * Converts a JTS polygon back to its GeoJSON shape (outer ring only — V1 stores no holes).
   *
   * @param polygon the polygon, or null
   * @return the GeoJSON dto, or null for a null input
   */
  public static GeoJsonPolygonDto toDto(Polygon polygon) {
    if (polygon == null) {
      return null;
    }
    List<List<Double>> ring = new ArrayList<>();
    for (Coordinate coordinate : polygon.getExteriorRing().getCoordinates()) {
      ring.add(List.of(coordinate.x, coordinate.y));
    }
    return new GeoJsonPolygonDto(POLYGON_TYPE, List.of(ring));
  }

  /**
   * A compact, human-readable form for audit snapshots (RBAC-05) — vertex count plus bbox keeps
   * entries readable instead of dumping every coordinate.
   *
   * @param polygon the polygon, or null
   * @return e.g. {@code polygon[vertices=5, bbox=[36.0, 33.0, 36.5, 33.5]]}, or null
   */
  public static String compact(Polygon polygon) {
    if (polygon == null) {
      return null;
    }
    Envelope envelope = polygon.getEnvelopeInternal();
    return "polygon[vertices=%d, bbox=[%s, %s, %s, %s]]"
        .formatted(
            polygon.getExteriorRing().getNumPoints(),
            envelope.getMinX(),
            envelope.getMinY(),
            envelope.getMaxX(),
            envelope.getMaxY());
  }
}
