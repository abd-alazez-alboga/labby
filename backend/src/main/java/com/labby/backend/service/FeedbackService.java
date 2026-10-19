package com.labby.backend.service;

import com.labby.backend.dto.AdminFeedbackDto;
import com.labby.backend.dto.AdminFeedbackPageDto;
import com.labby.backend.dto.FeedbackDto;
import com.labby.backend.dto.FeedbackRequestDto;
import com.labby.backend.dto.FeedbackStatsDto;
import com.labby.backend.enums.FeedbackCategory;
import com.labby.backend.enums.RideParty;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Feedback (FDBK-01, UC-S-22, UC-A-25; support-v1.yaml). */
public interface FeedbackService {

  /**
   * Records an entry; no notification, no per-item response promised.
   *
   * @param userId the caller
   * @param request category, text, and the sending app (checked against the caller's roles)
   * @return the entry
   */
  FeedbackDto submit(UUID userId, FeedbackRequestDto request);

  /**
   * The admin browse, newest first.
   *
   * @param category optional category
   * @param tag optional tag
   * @param submittedAs optional app filter
   * @param from optional inclusive lower bound
   * @param to optional exclusive upper bound
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  AdminFeedbackPageDto adminList(
      FeedbackCategory category,
      String tag,
      RideParty submittedAs,
      Instant from,
      Instant to,
      int page,
      int size);

  /**
   * Counts by category per UTC bucket, empty buckets included (400 {@code range_invalid} when
   * {@code to <= from} or the range exceeds 366 days).
   *
   * @param from inclusive
   * @param to exclusive
   * @param bucket day, week or month
   * @param submittedAs optional app filter
   * @return the stats
   */
  FeedbackStatsDto stats(Instant from, Instant to, String bucket, RideParty submittedAs);

  /**
   * Replaces an entry's tags (audited {@code feedback.tag}): trimmed, lower-cased, deduplicated;
   * 422 {@code tag_invalid} for a blank or over-long tag.
   *
   * @param adminUserId the acting admin
   * @param feedbackId the entry
   * @param tags the new tags
   * @return the entry
   */
  AdminFeedbackDto tag(UUID adminUserId, UUID feedbackId, List<String> tags);
}
