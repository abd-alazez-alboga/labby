package com.labby.backend.dto;

import java.util.UUID;

/** A saved place (UC-R-01). */
public record SavedLocationDto(UUID id, String name, double lat, double lng, String address) {}
