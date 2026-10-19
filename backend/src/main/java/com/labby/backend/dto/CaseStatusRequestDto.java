package com.labby.backend.dto;

import com.labby.backend.enums.CaseStatus;
import jakarta.validation.constraints.NotNull;

/** Progress a lost-item case (UC-A-22). */
public record CaseStatusRequestDto(@NotNull CaseStatus caseStatus) {}
