package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * OTP policy (AUTH-04): 6 digits, 5-min expiry, 5 attempts per code, 60s resend cooldown, 5 codes
 * per phone per hour — all environment-tunable, documented in {@code .env.example}.
 *
 * @param expirySeconds code validity
 * @param maxAttempts wrong attempts tolerated per code
 * @param resendCooldownSeconds minimum gap between codes for the same phone and purpose
 * @param maxPerPhonePerHour codes allowed per phone per rolling hour
 */
@ConfigurationProperties(prefix = "labby.otp")
public record OtpProperties(
    long expirySeconds, int maxAttempts, long resendCooldownSeconds, int maxPerPhonePerHour) {}
