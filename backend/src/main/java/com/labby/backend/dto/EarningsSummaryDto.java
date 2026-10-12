package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

/** A weekly / monthly earnings summary (money-v1 EarningsSummary, UC-D-15). */
public record EarningsSummaryDto(
    String period,
    LocalDate from,
    LocalDate to,
    String currency,
    int trips,
    BigDecimal fares,
    BigDecimal commission,
    BigDecimal tips,
    BigDecimal net) {}
