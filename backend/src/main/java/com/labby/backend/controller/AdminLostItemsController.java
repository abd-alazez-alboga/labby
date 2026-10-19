package com.labby.backend.controller;

import com.labby.backend.dto.AdminTicketDto;
import com.labby.backend.dto.AdminTicketPageDto;
import com.labby.backend.dto.CaseStatusRequestDto;
import com.labby.backend.enums.CaseStatus;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.LostItemService;
import com.labby.backend.util.WireEnums;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The admin lost-item queue (support-v1.yaml AdminLostItems: LOST-02, UC-A-22). */
@RestController
@RequestMapping("/api/v1/admin/lost-items")
@Tag(name = "AdminLostItems", description = "Lost-item queue and case progression")
@RequiredArgsConstructor
public class AdminLostItemsController {

  private final LostItemService lostItemService;

  /**
   * The lost-item slice of the queue; default every non-closed case.
   *
   * @param caseStatus optional case-status filter (repeatable)
   * @param page zero-based page
   * @param size page size (1..50)
   * @return 200 with one page
   */
  @GetMapping
  @PreAuthorize("hasAuthority('support:view')")
  @Operation(summary = "Lost-item queue (UC-A-22)")
  public ResponseEntity<AdminTicketPageDto> queue(
      @RequestParam(required = false) List<String> caseStatus,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        lostItemService.adminQueue(
            WireEnums.parseAll(CaseStatus::fromValue, caseStatus, "caseStatus"),
            Math.max(0, page),
            Math.clamp(size, 1, 50)));
  }

  /**
   * Progresses a case (audited; both parties notified; closing returns the chat to read-only).
   *
   * @return 200 with the ticket; 404 unknown or not a case; 409 invalid_transition
   */
  @PostMapping("/{ticketId}/case-status")
  @PreAuthorize("hasAuthority('support:handle')")
  @Operation(summary = "Progress a lost-item case (LOST-02)")
  public ResponseEntity<AdminTicketDto> caseStatus(
      @PathVariable UUID ticketId, @Valid @RequestBody CaseStatusRequestDto request) {
    return ResponseEntity.ok(
        lostItemService.setCaseStatus(
            SecurityUtils.currentUserId(), ticketId, request.caseStatus()));
  }
}
