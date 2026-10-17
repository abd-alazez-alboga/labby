package com.labby.backend.dto;

import com.labby.backend.enums.PromoType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** A promo with its redemption counters (growth-v1 Promo, admin views). */
public record PromoDto(
    UUID promoId,
    String code,
    UUID regionId,
    UUID serviceTypeId,
    PromoType type,
    BigDecimal value,
    BigDecimal maxDiscount,
    Instant startsAt,
    Instant endsAt,
    int perUserLimit,
    Integer totalCap,
    boolean firstRideOnly,
    boolean active,
    long redemptionCount,
    BigDecimal redeemedAmount) {}
