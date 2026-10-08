package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** Pickup, destination and intermediate stops (more than 3 stops is a 422, not a 400). */
public record RouteInputDto(
    @NotNull @Valid PlaceDto pickup,
    @NotNull @Valid PlaceDto destination,
    List<@Valid PlaceDto> stops) {}
