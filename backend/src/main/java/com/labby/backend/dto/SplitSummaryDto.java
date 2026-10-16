package com.labby.backend.dto;

import java.math.BigDecimal;

/** RIDE-P4: how the stored fare was divided over the boarded seats. */
public record SplitSummaryDto(
    BigDecimal fareTotal, String currency, int boardedSeats, BigDecimal perSeatAmount) {}
