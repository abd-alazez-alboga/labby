package com.labby.backend.dto;

import com.labby.backend.enums.RegionState;
import java.util.UUID;

/** One row of the admin region list (regions-v1.yaml RegionSummary). */
public record RegionSummaryDto(UUID id, String name, RegionState state, String currency) {}
