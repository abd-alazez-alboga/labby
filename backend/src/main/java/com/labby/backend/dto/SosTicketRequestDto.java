package com.labby.backend.dto;

import com.labby.backend.enums.TicketPriority;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/** Open the linked ticket of an SOS event on the caller's behalf (support-v1 ruling 9). */
public record SosTicketRequestDto(
    @NotNull UUID categoryId,
    @NotBlank @Size(max = 4000) String description,
    TicketPriority priority) {}
