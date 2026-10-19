package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/** Open a support ticket (support-v1 {@code CreateTicketRequest}, UC-S-19). */
public record CreateTicketRequestDto(
    @NotNull UUID categoryId,
    @NotBlank @Size(max = 4000) String description,
    UUID rideId,
    @Size(max = 5) List<UUID> attachmentFileIds) {}
