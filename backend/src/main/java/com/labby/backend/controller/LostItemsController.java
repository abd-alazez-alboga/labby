package com.labby.backend.controller;

import com.labby.backend.dto.LostItemCaseDto;
import com.labby.backend.dto.LostItemCasePageDto;
import com.labby.backend.dto.LostItemReportRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.LostItemService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Lost items: rider reports, both parties view (support-v1.yaml LostItems: UC-R-20, UC-D-21). */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "LostItems", description = "Report a lost item; follow the case")
@RequiredArgsConstructor
public class LostItemsController {

  private final LostItemService lostItemService;

  /**
   * Reports a lost item on a completed ride: case opened, chat reopened, both parties notified.
   *
   * @param rideId the ride
   * @param request description and up to 3 photos
   * @return 201 with the case; 400 photos; 403 not the rider; 404 unknown ride; 409
   *     ride_not_completed / lost_item_case_open
   */
  @PostMapping("/rides/{rideId}/lost-item")
  @Operation(summary = "Report a lost item on a completed ride (UC-R-20)")
  public ResponseEntity<LostItemCaseDto> report(
      @PathVariable UUID rideId, @Valid @RequestBody LostItemReportRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(lostItemService.report(SecurityUtils.currentUserId(), rideId, request));
  }

  /**
   * The caller's cases, as the reporting rider or as the driver of the ride.
   *
   * @param open true = not closed
   * @param page zero-based page
   * @param size page size (1..50)
   * @return 200 with one page
   */
  @GetMapping("/lost-items")
  @Operation(summary = "My lost-item cases (UC-D-21)")
  public ResponseEntity<LostItemCasePageDto> mine(
      @RequestParam(required = false) Boolean open,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        lostItemService.mine(
            SecurityUtils.currentUserId(),
            Boolean.TRUE.equals(open),
            Math.max(0, page),
            Math.clamp(size, 1, 50)));
  }

  /**
   * One case the caller is a party to.
   *
   * @param ticketId the case
   * @return 200 with the case; 404 unknown or not a party
   */
  @GetMapping("/lost-items/{ticketId}")
  @Operation(summary = "One lost-item case, rider or driver view")
  public ResponseEntity<LostItemCaseDto> caseOf(@PathVariable UUID ticketId) {
    return ResponseEntity.ok(lostItemService.caseOf(SecurityUtils.currentUserId(), ticketId));
  }
}
