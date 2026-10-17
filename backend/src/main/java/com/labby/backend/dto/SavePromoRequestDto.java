package com.labby.backend.dto;

import com.labby.backend.enums.PromoType;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Create a promo (growth-v1 SavePromoRequest; UC-A-26). The code is stored uppercase. */
public record SavePromoRequestDto(
    @NotNull @Pattern(regexp = "^[A-Za-z0-9]{3,20}$") String code,
    UUID regionId,
    UUID serviceTypeId,
    @NotNull PromoType type,
    @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal value,
    @DecimalMin(value = "0", inclusive = false) BigDecimal maxDiscount,
    @NotNull Instant startsAt,
    @NotNull Instant endsAt,
    @Min(1) Integer perUserLimit,
    @Min(1) Integer totalCap,
    Boolean firstRideOnly) {}
