package com.labby.backend.dto;

/**
 * Profile-photo bytes served through the authenticated, owner-only endpoint (NFR-S2).
 *
 * @param content the image bytes
 * @param contentType the stored media type
 */
public record UserPhotoDto(byte[] content, String contentType) {}
