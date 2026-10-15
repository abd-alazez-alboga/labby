package com.labby.backend.dto;

import com.labby.backend.enums.ReportCategory;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/** REP-01: a report of the ride's counterpart (trust-v1 ReportRequest). */
public record ReportRequestDto(
    @NotNull ReportCategory category,
    @Size(max = 2000) String description,
    @Size(max = 3) List<@NotNull UUID> photoFileIds) {}
