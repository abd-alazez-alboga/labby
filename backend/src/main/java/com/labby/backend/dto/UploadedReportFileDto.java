package com.labby.backend.dto;

import java.util.UUID;

/** A stored report photo (trust-v1 UploadedReportFile), usable only by its uploader. */
public record UploadedReportFileDto(UUID fileId, String contentType, long sizeBytes) {}
