package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** REP-02: the outcome with mandatory internal notes. */
public record ReportResolveRequestDto(
    @NotNull @Pattern(regexp = "substantiated|unsubstantiated") String outcome,
    @NotBlank @Size(max = 2000) String note) {}
