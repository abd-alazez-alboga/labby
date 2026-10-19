package com.labby.backend.controller;

import com.labby.backend.dto.AdminFeedbackDto;
import com.labby.backend.dto.AdminFeedbackPageDto;
import com.labby.backend.dto.FeedbackStatsDto;
import com.labby.backend.dto.FeedbackTagsRequestDto;
import com.labby.backend.enums.FeedbackCategory;
import com.labby.backend.enums.RideParty;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.FeedbackService;
import com.labby.backend.util.WireEnums;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The admin feedback browser (support-v1.yaml AdminFeedback: FDBK-01, UC-A-25). */
@RestController
@RequestMapping("/api/v1/admin/feedback")
@Tag(name = "AdminFeedback", description = "Browse, tag and trend feedback")
@RequiredArgsConstructor
public class AdminFeedbackController {

  private final FeedbackService feedbackService;

  /** Browse, newest first, with optional filters. */
  @GetMapping
  @PreAuthorize("hasAuthority('support:view')")
  @Operation(summary = "Browse feedback (UC-A-25)")
  public ResponseEntity<AdminFeedbackPageDto> list(
      @RequestParam(required = false) String category,
      @RequestParam(required = false) String tag,
      @RequestParam(required = false) String submittedAs,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
          Instant from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
          Instant to,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        feedbackService.adminList(
            WireEnums.parse(FeedbackCategory::fromValue, category, "category"),
            tag,
            WireEnums.parse(RideParty::fromValue, submittedAs, "submittedAs"),
            from,
            to,
            Math.max(0, page),
            Math.clamp(size, 1, 50)));
  }

  /** Counts by category per time bucket; 400 range_invalid. */
  @GetMapping("/stats")
  @PreAuthorize("hasAuthority('support:view')")
  @Operation(summary = "Feedback counts by category per bucket (FDBK-01)")
  public ResponseEntity<FeedbackStatsDto> stats(
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
      @RequestParam(defaultValue = "day") String bucket,
      @RequestParam(required = false) String submittedAs) {
    return ResponseEntity.ok(
        feedbackService.stats(
            from, to, bucket, WireEnums.parse(RideParty::fromValue, submittedAs, "submittedAs")));
  }

  /** Replaces an entry's tags (audited); 422 tag_invalid. */
  @PutMapping("/{feedbackId}/tags")
  @PreAuthorize("hasAuthority('support:handle')")
  @Operation(summary = "Tag a feedback entry")
  public ResponseEntity<AdminFeedbackDto> tag(
      @PathVariable UUID feedbackId, @Valid @RequestBody FeedbackTagsRequestDto request) {
    return ResponseEntity.ok(
        feedbackService.tag(SecurityUtils.currentUserId(), feedbackId, request.tags()));
  }
}
