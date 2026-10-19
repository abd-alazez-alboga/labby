package com.labby.backend.controller;

import com.labby.backend.dto.FeedbackDto;
import com.labby.backend.dto.FeedbackRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.FeedbackService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Feedback for both apps (support-v1.yaml Feedback: FDBK-01, UC-S-22). */
@RestController
@RequestMapping("/api/v1/feedback")
@Tag(name = "Feedback", description = "Submit feedback or a suggestion")
@RequiredArgsConstructor
public class FeedbackController {

  private final FeedbackService feedbackService;

  /**
   * Records feedback — no per-item response promised.
   *
   * @param request category, text, sending app
   * @return 201 with the entry; 400 invalid_category; 403 the account lacks that role
   */
  @PostMapping
  @Operation(summary = "Submit feedback or a suggestion (UC-S-22)")
  public ResponseEntity<FeedbackDto> submit(@Valid @RequestBody FeedbackRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(feedbackService.submit(SecurityUtils.currentUserId(), request));
  }
}
