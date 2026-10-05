package com.labby.backend.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/** Replace an admin's single role; effective immediately (UC-A-02). */
public record ChangeAdminRoleRequestDto(@NotNull UUID roleId) {}
