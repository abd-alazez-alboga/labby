package com.labby.backend.dto;

import com.labby.backend.enums.RoleState;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * An admin account: the user behind the {@code admin} role assignment plus its single RBAC role
 * (SRS §5.1). {@code state} is the admin role-assignment state (deactivate = suspend it).
 */
public record AdminAccountDto(
    UUID id,
    String phone,
    String name,
    RoleState state,
    RoleSummaryDto role,
    OffsetDateTime grantedAt) {}
