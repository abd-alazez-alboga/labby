package com.labby.backend.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;

/** A tip in the ride's currency (money-v1 TipRequest, PAY-04). */
public record TipRequestDto(@NotNull @Positive BigDecimal amount) {}
