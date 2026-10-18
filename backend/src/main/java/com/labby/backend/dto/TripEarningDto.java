package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * The COM-01 itemization of one ride's money (money-v1 TripEarning). For a cancelled ride whose fee
 * was collected for this driver, the fare fields are 0 and {@code cancellationFee} carries the
 * credit; {@code completedAt} is then the collection moment. {@code promoCompensation} (M13 ruling
 * 1) is the platform-funded promo discount credited for the ride, already inside {@code net}; null
 * when the ride had no promo.
 */
public record TripEarningDto(
    UUID rideId,
    Instant completedAt,
    String currency,
    BigDecimal fareTotal,
    PaymentMethod paymentMethod,
    BigDecimal commissionRate,
    BigDecimal commissionAmount,
    BigDecimal tip,
    BigDecimal cancellationFee,
    BigDecimal promoCompensation,
    BigDecimal net) {}
