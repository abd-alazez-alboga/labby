package com.labby.backend.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;
import java.util.UUID;

/** One append-only audit entry: actor, action, target, before/after (RBAC-05, UC-A-04). */
public record AuditLogEntryDto(
    UUID id,
    UUID actorId,
    String actorName,
    String action,
    String targetType,
    String targetId,
    JsonNode before,
    JsonNode after,
    OffsetDateTime createdAt) {}
