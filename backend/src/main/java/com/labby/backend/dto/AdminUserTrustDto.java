package com.labby.backend.dto;

import com.labby.backend.enums.AccountState;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** The trust sections of a user profile (UC-A-13, trust-v1 AdminUserTrust). */
public record AdminUserTrustDto(
    UUID userId,
    String name,
    AccountState accountState,
    String accountSuspensionNote,
    Instant accountSuspendedAt,
    List<RoleTrustDto> roles) {}
