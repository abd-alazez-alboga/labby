package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;

/**
 * Pickup, destination and intermediate stops (more than 3 stops is a 422, not a 400). {@code
 * scheduledAt} (M12, estimate only) prices a scheduled ride: that moment's surcharge, no surge.
 */
public record RouteInputDto(
    @NotNull @Valid PlaceDto pickup,
    @NotNull @Valid PlaceDto destination,
    List<@Valid PlaceDto> stops,
    Instant scheduledAt) {}
