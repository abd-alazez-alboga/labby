package com.labby.backend.dto;

import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.Language;
import java.util.List;
import java.util.UUID;

/** The authenticated user's profile as served to every client (USR-01..04). */
public record UserProfileDto(
    UUID id,
    String phone,
    String name,
    Language language,
    String photoUrl,
    AccountState state,
    List<RoleAssignmentDto> roles) {}
