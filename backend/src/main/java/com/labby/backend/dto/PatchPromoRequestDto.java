package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Edit or deactivate a promo (growth-v1 PatchPromoRequest): window, caps and restrictions move;
 * {@code code}, {@code type} and {@code value} are fixed after creation. Null keeps the stored
 * value ({@code active} false = deactivate).
 */
public record PatchPromoRequestDto(
    UUID regionId,
    UUID serviceTypeId,
    @DecimalMin(value = "0", inclusive = false) BigDecimal maxDiscount,
    Instant startsAt,
    Instant endsAt,
    @Min(1) Integer perUserLimit,
    @Min(1) Integer totalCap,
    Boolean firstRideOnly,
    Boolean active) {}
