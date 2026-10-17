package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** One promo with one page of its redemptions (growth-v1 PromoDetail). */
public record PromoDetailDto(PromoDto promo, RedemptionPageDto redemptions) {

  /** One redemption row (admin monitoring). */
  public record PromoRedemptionDto(
      UUID promoRedemptionId,
      UUID userId,
      String userName,
      UUID rideId,
      BigDecimal amount,
      String currency,
      Instant createdAt) {}

  /** One page of redemptions, newest first. */
  public record RedemptionPageDto(
      List<PromoRedemptionDto> items, int page, int size, long totalItems) {}
}
