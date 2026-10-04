package com.labby.backend.controller;

import com.labby.backend.dto.MetaResponseDto;
import com.labby.backend.service.MetaService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Serves public metadata about the running API. */
@RestController
@RequestMapping("/api/v1/meta")
@Tag(name = "Meta", description = "Public API metadata")
@RequiredArgsConstructor
public class MetaController {

  private final MetaService metaService;

  /**
   * Returns the application's name and version.
   *
   * @return 200 with the API metadata
   */
  @GetMapping
  @Operation(summary = "Get API metadata", description = "Returns the API name and version.")
  @ApiResponse(responseCode = "200", description = "API metadata")
  public ResponseEntity<MetaResponseDto> getMeta() {
    return ResponseEntity.ok(metaService.getMeta());
  }
}
