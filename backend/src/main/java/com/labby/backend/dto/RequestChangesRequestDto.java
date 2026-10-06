package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Request per-item changes (→ needs_changes). Each item at most once.
 *
 * @param items the flagged items with a note each
 * @param note optional overall note, recorded in the stage history
 */
public record RequestChangesRequestDto(
    @NotEmpty List<@Valid RequestChangesItemDto> items, @Size(max = 1000) String note) {}
