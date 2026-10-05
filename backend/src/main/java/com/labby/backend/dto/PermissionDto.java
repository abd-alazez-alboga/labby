package com.labby.backend.dto;

/** A catalog permission; {@code code} is the {@code domain:action} string (RBAC-02). */
public record PermissionDto(String code, String domain) {}
