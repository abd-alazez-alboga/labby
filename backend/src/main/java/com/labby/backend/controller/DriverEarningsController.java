package com.labby.backend.controller;

import com.labby.backend.dto.DriverBalanceViewDto;
import com.labby.backend.dto.EarningsSummaryDto;
import com.labby.backend.dto.TripEarningDto;
import com.labby.backend.dto.TripEarningPageDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverEarningsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Pattern;
import java.time.LocalDate;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The driver's money views (money-v1.yaml, UC-D-15/16). */
@RestController
@Validated
@RequestMapping("/api/v1/driver")
@Tag(name = "DriverEarnings", description = "Earnings, summaries, balance and floor status")
@RequiredArgsConstructor
public class DriverEarningsController {

  private final DriverEarningsService driverEarningsService;

  /**
   * Per-trip earnings, newest first (COM-01).
   *
   * @param page zero-based page
   * @param size page size (1..100)
   * @return 200 with one page
   */
  @GetMapping("/earnings")
  @Operation(summary = "Per-trip earnings, itemized (UC-D-15)")
  public ResponseEntity<TripEarningPageDto> earnings(
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        driverEarningsService.earnings(
            SecurityUtils.currentUserId(), Math.max(0, page), Math.clamp(size, 1, 100)));
  }

  /**
   * One trip's detail (V1 conformance W43): a ride the driver drove, or accepted before it was
   * cancelled, with the driver's own report on its rider.
   *
   * @param rideId the ride
   * @param memberId the shared-ride member (required when the ride has several rows)
   * @return 200 with the trip
   */
  @GetMapping("/earnings/rides/{rideId}")
  @Operation(summary = "One trip's detail with the driver's report status (UC-D-15, REP-01)")
  public ResponseEntity<TripEarningDto> trip(
      @PathVariable UUID rideId, @RequestParam(required = false) UUID memberId) {
    return ResponseEntity.ok(
        driverEarningsService.trip(SecurityUtils.currentUserId(), rideId, memberId));
  }

  /**
   * The weekly / monthly summary containing the anchor date.
   *
   * @param period weekly (Monday-start, operating region time zone) or monthly
   * @param anchor the anchor date (today when omitted)
   * @return 200 with the summary
   */
  @GetMapping("/earnings/summary")
  @Operation(summary = "Weekly / monthly earnings summary (UC-D-15)")
  public ResponseEntity<EarningsSummaryDto> summary(
      @RequestParam @Pattern(regexp = "weekly|monthly") String period,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate anchor) {
    return ResponseEntity.ok(
        driverEarningsService.summary(SecurityUtils.currentUserId(), period, anchor));
  }

  /**
   * Balance, floor status and commission tier (COM-02/03).
   *
   * @return 200 with the view
   */
  @GetMapping("/balance")
  @Operation(summary = "Balance, floor status and commission tier (UC-D-16)")
  public ResponseEntity<DriverBalanceViewDto> balance() {
    return ResponseEntity.ok(driverEarningsService.balance(SecurityUtils.currentUserId()));
  }
}
