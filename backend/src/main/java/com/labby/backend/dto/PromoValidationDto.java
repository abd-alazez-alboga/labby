package com.labby.backend.dto;

import com.labby.backend.enums.PromoType;
import java.math.BigDecimal;

/**
 * A valid promo's terms and preview (growth-v1 PromoValidation). {@code discountPreview} is
 * computed against the given estimate, null without one or for a scheduled booking.
 */
public record PromoValidationDto(
    String code,
    PromoType type,
    BigDecimal value,
    BigDecimal maxDiscount,
    BigDecimal discountPreview) {}
