package com.labby.backend.controller;

import com.labby.backend.dto.FileContentDto;
import com.labby.backend.service.FileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Serves private files through expiring URLs (NFR-S2, onboarding-v1.yaml). No Bearer token: the
 * signed, short-lived token in the path IS the capability, minted only by authenticated,
 * permission-checked endpoints. Any invalid/expired token is a plain 404.
 */
@RestController
@RequestMapping("/api/v1/files")
@Tag(name = "Files", description = "Expiring private-file URLs (NFR-S2)")
@RequiredArgsConstructor
public class FileController {

  private final FileService fileService;

  /**
   * Streams the file behind an expiring access token.
   *
   * @param token the signed token
   * @return 200 with the bytes, never cached
   */
  @GetMapping("/{token}")
  @Operation(summary = "Open a private file through an expiring URL")
  public ResponseEntity<byte[]> getFile(@PathVariable String token) {
    FileContentDto file = fileService.open(token);
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_TYPE, file.contentType())
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
        .header("X-Content-Type-Options", "nosniff")
        .body(file.content());
  }
}
