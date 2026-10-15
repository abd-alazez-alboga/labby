package com.labby.backend.controller;

import com.labby.backend.dto.OwnRatingAggregateDto;
import com.labby.backend.dto.PendingRatingDto;
import com.labby.backend.dto.RatingRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.RatingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Ratings for both apps (trust-v1.yaml Ratings: RATE-01/02, UC-S-17). */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "Ratings", description = "Rate a ride's counterpart; own exposed averages")
@RequiredArgsConstructor
public class RatingsController {

  private final RatingService ratingService;

  /**
   * Rates the counterpart of a completed ride (once, within 7 days, immutable).
   *
   * @param rideId the ride
   * @param request score 1..5 and optional comment
   * @return 204; 403 not a party; 404 unknown ride; 409 ride_not_completed, rating_window_closed or
   *     rating_already_submitted
   */
  @PostMapping("/rides/{rideId}/rating")
  @Operation(summary = "Rate the counterpart of a completed ride (UC-S-17)")
  public ResponseEntity<Void> rate(
      @PathVariable UUID rideId, @Valid @RequestBody RatingRequestDto request) {
    ratingService.rate(SecurityUtils.currentUserId(), rideId, request);
    return ResponseEntity.noContent().build();
  }

  /**
   * The caller's completed rides still inside the rating window and unrated, newest first.
   *
   * @param as {@code rider} or {@code driver}
   * @return 200 with the prompts
   */
  @GetMapping("/ratings/pending")
  @Operation(summary = "Completed rides the caller can still rate (prompt + history)")
  public ResponseEntity<List<PendingRatingDto>> pending(@RequestParam("as") String as) {
    return ResponseEntity.ok(ratingService.pending(SecurityUtils.currentUserId(), as));
  }

  /**
   * The caller's own per-role averages — the daily snapshot, null below 5 ratings (RATE-02).
   *
   * @return 200 with one entry per rider/driver role held
   */
  @GetMapping("/users/me/ratings")
  @Operation(summary = "The caller's own per-role averages (exposed view)")
  public ResponseEntity<List<OwnRatingAggregateDto>> mine() {
    return ResponseEntity.ok(ratingService.ownAggregates(SecurityUtils.currentUserId()));
  }
}
