package com.labby.backend.controller;

import com.labby.backend.dto.AdminTicketCategoryDto;
import com.labby.backend.dto.PatchTicketCategoryRequestDto;
import com.labby.backend.dto.SaveTicketCategoryRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.TicketCategoryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Ticket-category management (support-v1.yaml AdminTicketCategories: SUP-01/03, UC-A-24). */
@RestController
@RequestMapping("/api/v1/admin/ticket-categories")
@Tag(name = "AdminTicketCategories", description = "Ticket categories and their default priority")
@RequiredArgsConstructor
public class AdminTicketCategoriesController {

  private final TicketCategoryService ticketCategoryService;

  /** Every category, inactive and system ones included. */
  @GetMapping
  @PreAuthorize("hasAuthority('content:view')")
  @Operation(summary = "All ticket categories")
  public ResponseEntity<List<AdminTicketCategoryDto>> list() {
    return ResponseEntity.ok(ticketCategoryService.adminList());
  }

  /** Creates a category (audited). */
  @PostMapping
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Create a ticket category")
  public ResponseEntity<AdminTicketCategoryDto> create(
      @Valid @RequestBody SaveTicketCategoryRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(ticketCategoryService.create(SecurityUtils.currentUserId(), request));
  }

  /** Edits names, default priority, order or active flag (audited); 409 system_category. */
  @PatchMapping("/{ticketCategoryId}")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Edit a ticket category")
  public ResponseEntity<AdminTicketCategoryDto> patch(
      @PathVariable UUID ticketCategoryId,
      @Valid @RequestBody PatchTicketCategoryRequestDto request) {
    return ResponseEntity.ok(
        ticketCategoryService.patch(SecurityUtils.currentUserId(), ticketCategoryId, request));
  }

  /** Deletes an unused category (audited); 409 category_in_use / system_category. */
  @DeleteMapping("/{ticketCategoryId}")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Delete an unused ticket category")
  public ResponseEntity<Void> delete(@PathVariable UUID ticketCategoryId) {
    ticketCategoryService.delete(SecurityUtils.currentUserId(), ticketCategoryId);
    return ResponseEntity.noContent().build();
  }
}
