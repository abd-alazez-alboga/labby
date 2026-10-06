package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * A routing request (ES-04).
 *
 * @param points origin, up to 3 intermediate stops, destination (2..5 points, RIDE-01)
 */
public record RouteRequestDto(
    @NotNull @Size(min = 2, max = 5) List<@NotNull @Valid LatLngDto> points) {}
