package com.labby.backend.dto;

import java.math.BigDecimal;

/** One per-currency wallet balance (money-v1 WalletBalance). */
public record WalletBalanceDto(String currency, BigDecimal balance) {}
