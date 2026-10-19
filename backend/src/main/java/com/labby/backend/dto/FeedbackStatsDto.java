package com.labby.backend.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Counts by category per time bucket (support-v1 {@code FeedbackStats}, FDBK-01 trends); every
 * catalog category is present (zero included) and empty buckets are listed.
 */
public record FeedbackStatsDto(
    Instant from,
    Instant to,
    String bucket,
    long total,
    Map<String, Long> byCategory,
    List<BucketDto> buckets) {

  /** One bucket (UTC day / ISO week / month start). */
  public record BucketDto(Instant start, long total, Map<String, Long> byCategory) {}
}
