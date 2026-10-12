package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * An admin wallet credit (money-v1 WalletCreditRequest, PAY-03): {@code grant} (reason mandatory,
 * ride link optional) or {@code refund} (reason AND rideId mandatory).
 */
public record WalletCreditRequestDto(
    @NotNull @Pattern(regexp = "grant|refund") String type,
    @NotNull @Positive BigDecimal amount,
    @NotNull @Pattern(regexp = "^[A-Z]{3}$") String currency,
    @NotBlank @Size(max = 500) String reason,
    UUID rideId) {}
