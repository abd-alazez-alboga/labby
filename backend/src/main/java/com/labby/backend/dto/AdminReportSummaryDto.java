package com.labby.backend.dto;

import com.labby.backend.enums.ReportCategory;
import com.labby.backend.enums.ReportStatus;
import java.time.Instant;
import java.util.UUID;

/** A reports-queue row (UC-A-17, trust-v1 AdminReportSummary). */
public record AdminReportSummaryDto(
    UUID id,
    UUID rideId,
    ReportCategory category,
    ReportStatus status,
    PartySummaryDto reporter,
    PartySummaryDto reported,
    Instant createdAt,
    Instant resolvedAt,
    long photoCount) {}
