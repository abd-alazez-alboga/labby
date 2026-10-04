package com.labby.backend.dto;

/**
 * Issued session: short-lived access token, rotated refresh token, and the authenticated profile.
 */
public record AuthTokensResponseDto(
    String accessToken, String refreshToken, long expiresInSeconds, UserProfileDto user) {}
