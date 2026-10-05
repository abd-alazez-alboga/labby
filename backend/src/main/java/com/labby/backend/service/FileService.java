package com.labby.backend.service;

import com.labby.backend.dto.FileContentDto;

/** Serves private files through expiring URLs (NFR-S2). */
public interface FileService {

  /**
   * Opens the file an expiring access token points at.
   *
   * @param token the token from {@code /api/v1/files/{token}}
   * @return the bytes and media type
   * @throws com.labby.backend.exception.ResourceNotFoundException when the token is malformed,
   *     tampered with, expired, or the file is gone — deliberately indistinguishable
   */
  FileContentDto open(String token);
}
