package com.labby.backend.dto;

import java.math.BigDecimal;

/** An amount in one currency. */
public record MoneyAmountDto(String currency, BigDecimal amount) {}
