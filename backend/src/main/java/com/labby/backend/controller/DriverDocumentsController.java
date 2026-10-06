package com.labby.backend.controller;

import com.labby.backend.dto.DocumentDto;
import com.labby.backend.dto.DocumentRenewalRequestDto;
import com.labby.backend.dto.DocumentSlotDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverDocumentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** An approved driver's document slots and renewals (UC-D-19) per onboarding-v1.yaml. */
@RestController
@RequestMapping("/api/v1/driver/documents")
@Tag(name = "DriverDocuments", description = "Document slots and renewals")
@RequiredArgsConstructor
public class DriverDocumentsController {

  private final DriverDocumentService driverDocumentService;

  /**
   * The current document slots with expiry and renewal state.
   *
   * @return 200 with the slots
   */
  @GetMapping
  @Operation(summary = "The current document slots with expiry and renewal state")
  public ResponseEntity<List<DocumentSlotDto>> listSlots() {
    return ResponseEntity.ok(driverDocumentService.listSlots(SecurityUtils.currentUserId()));
  }

  /**
   * Submits a renewed document.
   *
   * @param type the slot's document type
   * @param request the renewed document
   * @return 201 with the pending renewal
   */
  @PostMapping("/{type}/renewal")
  @Operation(summary = "Submit a renewed document")
  public ResponseEntity<DocumentDto> submitRenewal(
      @PathVariable String type, @RequestBody DocumentRenewalRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(driverDocumentService.submitRenewal(SecurityUtils.currentUserId(), type, request));
  }
}
