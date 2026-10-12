package com.labby.backend.dto;

import com.labby.backend.enums.SettlementDirection;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/** A settlement to record (money-v1 SettlementRequest, COM-04): any positive amount is legal. */
public record SettlementRequestDto(
    @NotNull @Positive BigDecimal amount,
    @NotNull SettlementDirection direction,
    @NotNull @Pattern(regexp = "^[A-Z]{3}$") String currency,
    @Size(max = 500) String note) {}
