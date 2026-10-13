package com.labby.backend.dto;

import jakarta.validation.constraints.Size;

/**
 * The optional acknowledge body (comms-v1.yaml {@code POST /admin/sos-events/{id}/acknowledge}).
 *
 * @param note an optional note (the M14 linked-ticket stub)
 */
public record SosAcknowledgeRequestDto(@Size(max = 2000) String note) {}
