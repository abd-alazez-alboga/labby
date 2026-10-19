package com.labby.backend.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;

/** The complete new order, first = top (support-v1 {@code OrderRequest}). */
public record OrderRequestDto(@NotNull List<UUID> ids) {}
