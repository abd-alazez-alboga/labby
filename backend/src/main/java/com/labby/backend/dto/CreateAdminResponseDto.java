package com.labby.backend.dto;

import com.labby.backend.enums.AdminCreationMode;

/** Outcome of admin creation: a fresh account or the admin role granted to an existing one. */
public record CreateAdminResponseDto(AdminCreationMode mode, AdminAccountDto admin) {}
