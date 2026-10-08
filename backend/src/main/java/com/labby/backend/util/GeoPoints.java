package com.labby.backend.util;

import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.PrecisionModel;

/** SRID-4326 points for ride places (JTS x = lng, y = lat). */
public final class GeoPoints {

  private static final GeometryFactory GEOMETRY_FACTORY =
      new GeometryFactory(new PrecisionModel(), 4326);

  private GeoPoints() {}

  /**
   * A point at the coordinates.
   *
   * @param lat latitude
   * @param lng longitude
   * @return the SRID-4326 point
   */
  public static Point point(double lat, double lng) {
    return GEOMETRY_FACTORY.createPoint(new Coordinate(lng, lat));
  }
}
