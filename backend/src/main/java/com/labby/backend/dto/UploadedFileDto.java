package com.labby.backend.dto;

import com.labby.backend.enums.StoredFileKind;
import java.util.UUID;

/**
 * A private driver upload (NFR-S2), referenced afterwards by {@code fileId} — usable only by the
 * uploader (onboarding-v1.yaml {@code UploadedFile}).
 *
 * @param fileId the stored file id
 * @param kind document or vehicle photo
 * @param contentType the media type detected from the content (magic bytes)
 * @param sizeBytes the stored size
 */
public record UploadedFileDto(
    UUID fileId, StoredFileKind kind, String contentType, long sizeBytes) {}
