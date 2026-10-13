package com.labby.backend.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/**
 * The REST read-marker body (comms-v1.yaml {@code POST .../chat/read}).
 *
 * @param lastReadMessageId the newest message the caller has read
 */
public record ChatReadRequestDto(@NotNull UUID lastReadMessageId) {}
