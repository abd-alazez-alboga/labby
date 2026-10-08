package com.labby.backend.dto;

import java.util.List;

/** A GeoJSON LineString, coordinates in [lng, lat] order. */
public record GeoJsonLineStringDto(String type, List<double[]> coordinates) {}
