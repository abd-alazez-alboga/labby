package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** In-ride destination / stops change (RIDE-05, UC-R-06). */
public record RouteChangeRequestDto(
    @NotNull @Valid PlaceDto destination, List<@Valid PlaceDto> stops) {}
