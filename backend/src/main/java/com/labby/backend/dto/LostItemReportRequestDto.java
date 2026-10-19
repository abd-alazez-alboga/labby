package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/** Report a lost item on a completed ride (support-v1 {@code LostItemReportRequest}, UC-R-20). */
public record LostItemReportRequestDto(
    @NotBlank @Size(max = 4000) String description, @Size(max = 3) List<UUID> photoFileIds) {}
