package com.labby.backend.dto;

import java.util.UUID;

/** Compact role reference embedded in admin-account payloads. */
public record RoleSummaryDto(UUID id, String name) {}
