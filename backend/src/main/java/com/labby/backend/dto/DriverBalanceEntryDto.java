package com.labby.backend.dto;

import com.labby.backend.enums.FloorStatus;
import java.math.BigDecimal;

/** One per-currency driver balance with its floor standing (money-v1, COM-03). */
public record DriverBalanceEntryDto(
    String currency, BigDecimal balance, BigDecimal floor, FloorStatus status) {}
