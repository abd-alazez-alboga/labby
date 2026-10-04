package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * JWT and login-throttling settings (NFR-S1, NFR-S3); values come from the environment, documented
 * in {@code .env.example}.
 *
 * @param jwtSecret HS256 signing secret, at least 32 bytes
 * @param accessTtlSeconds access-token lifetime
 * @param refreshTtlSeconds refresh-token lifetime
 * @param loginMaxAttempts failed logins per phone+IP tolerated inside the window
 * @param loginWindowSeconds sliding window for login throttling
 */
@ConfigurationProperties(prefix = "labby.auth")
public record AuthProperties(
    String jwtSecret,
    long accessTtlSeconds,
    long refreshTtlSeconds,
    int loginMaxAttempts,
    long loginWindowSeconds) {}
