package com.labby.backend.dto;

import com.labby.backend.enums.FlagKind;
import com.labby.backend.enums.FlagStatus;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** A flagged-accounts queue entry (UC-A-16, trust-v1 AccountFlag). */
public record AccountFlagDto(
    UUID id,
    PartySummaryDto user,
    FlagKind kind,
    FlagStatus status,
    Map<String, Object> details,
    Instant raisedAt,
    Instant resolvedAt,
    String resolutionNote) {}
