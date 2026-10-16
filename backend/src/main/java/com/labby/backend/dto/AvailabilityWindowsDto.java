package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/** The driver's whole weekly set (UC-D-05) — replaced at once; at most 50 rows. */
public record AvailabilityWindowsDto(
    @NotNull @Size(max = 50) List<@NotNull @Valid AvailabilityWindowDto> windows) {}
