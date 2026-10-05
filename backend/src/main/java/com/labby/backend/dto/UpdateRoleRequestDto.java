package com.labby.backend.dto;

import com.labby.backend.enums.Permission;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Edit a role's name/permissions — applies instantly to every holder (RBAC-02). Super Admin is
 * immutable; system roles cannot be renamed (enforced in M3-T2).
 */
public record UpdateRoleRequestDto(
    @NotBlank @Size(max = 50) String name, @NotNull List<Permission> permissions) {}
