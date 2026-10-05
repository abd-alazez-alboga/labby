package com.labby.backend.dto;

/**
 * Private file bytes served through an expiring URL (NFR-S2).
 *
 * @param content the bytes
 * @param contentType the stored media type
 */
public record FileContentDto(byte[] content, String contentType) {}
