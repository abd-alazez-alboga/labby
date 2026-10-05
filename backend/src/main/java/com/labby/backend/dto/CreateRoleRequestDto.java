package com.labby.backend.dto;

import com.labby.backend.enums.Permission;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/** Create a custom role by ticking catalog permissions (UC-A-03, RBAC-02). */
public record CreateRoleRequestDto(
    @NotBlank @Size(max = 50) String name, @NotNull List<Permission> permissions) {}
