package com.labby.backend.dto;

import java.util.List;
import java.util.UUID;

/**
 * A role with its granted permission codes (UC-A-03). {@code assignedAdminCount} lets the UI
 * explain why deletion is blocked (RBAC-02 E2).
 */
public record RoleDto(
    UUID id, String name, boolean isSystem, List<String> permissions, long assignedAdminCount) {}
