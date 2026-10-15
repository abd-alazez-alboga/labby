package com.labby.backend.dto;

import com.labby.backend.enums.ReportCategory;
import com.labby.backend.enums.ReportStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One report with its evidence references and both parties' history (UC-A-17, trust-v1
 * AdminReport). The evidence panel opens the ride detail, GPS trace and chat log by {@code rideId}.
 */
public record AdminReportDto(
    UUID id,
    UUID rideId,
    ReportCategory category,
    ReportStatus status,
    PartySummaryDto reporter,
    PartySummaryDto reported,
    Instant createdAt,
    Instant resolvedAt,
    long photoCount,
    String description,
    List<String> photoUrls,
    String resolutionNote,
    ResolvedByDto resolvedBy,
    ReportHistoryDto reporterHistory,
    ReportHistoryDto reportedHistory) {

  /**
   * The admin who resolved the report.
   *
   * @param userId the admin
   * @param name their name
   */
  public record ResolvedByDto(UUID userId, String name) {}
}
