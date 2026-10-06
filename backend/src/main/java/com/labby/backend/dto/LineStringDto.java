package com.labby.backend.dto;

import java.util.List;

/**
 * A GeoJSON LineString.
 *
 * @param type always {@code LineString}
 * @param coordinates the path, [lng, lat] per point
 */
public record LineStringDto(String type, List<double[]> coordinates) {

  /**
   * Wraps coordinates as a LineString.
   *
   * @param coordinates [lng, lat] points
   * @return the line string
   */
  public static LineStringDto of(List<double[]> coordinates) {
    return new LineStringDto("LineString", coordinates);
  }
}
