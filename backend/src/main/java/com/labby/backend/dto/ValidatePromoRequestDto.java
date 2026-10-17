package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Pre-booking promo check (growth-v1 ValidatePromoRequest). {@code estimateTotal} drives the
 * discount preview; {@code scheduledAt} marks a scheduled booking (ruling 3: validated now, the
 * amount computed at ride time, so the preview is null).
 */
public record ValidatePromoRequestDto(
    @NotBlank String code,
    @NotNull UUID regionId,
    @NotNull UUID serviceTypeId,
    @DecimalMin(value = "0", inclusive = false) BigDecimal estimateTotal,
    Instant scheduledAt) {}
