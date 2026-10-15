package com.labby.backend.dto;

import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.Language;
import java.util.List;
import java.util.UUID;

/**
 * The authenticated user's profile as served to every client (USR-01..04). {@code state} {@code
 * suspended} is the M11 whole-account suspension (USR-06), with the admin's {@code suspensionNote}.
 */
public record UserProfileDto(
    UUID id,
    String phone,
    String name,
    Language language,
    String photoUrl,
    AccountState state,
    String suspensionNote,
    List<RoleAssignmentDto> roles) {}
