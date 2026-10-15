package com.labby.backend.dto;

import java.util.List;

/** DRV-06 metrics over one rolling window (7 or 30 days, ending now). */
public record MetricWindowDto(
    int days,
    PercentageDto acceptance,
    PercentageDto cancellation,
    PercentageDto onTime,
    long trips,
    List<MoneyAmountDto> earnings) {}
