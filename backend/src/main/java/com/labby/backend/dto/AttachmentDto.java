package com.labby.backend.dto;

import java.util.UUID;

/** A ticket attachment / case photo with its signed private URL (support-v1 {@code Attachment}). */
public record AttachmentDto(UUID fileId, String contentType, long sizeBytes, String url) {}
