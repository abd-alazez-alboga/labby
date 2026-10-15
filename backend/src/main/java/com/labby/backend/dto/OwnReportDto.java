package com.labby.backend.dto;

import com.labby.backend.enums.ReportCategory;
import com.labby.backend.enums.ReportStatus;
import java.time.Instant;
import java.util.UUID;

/**
 * The reporter's view of a report — outcome only, never the internal notes (trust-v1 OwnReport).
 */
public record OwnReportDto(
    UUID id,
    UUID rideId,
    ReportCategory category,
    ReportStatus status,
    Instant createdAt,
    Instant resolvedAt) {}
