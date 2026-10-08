package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.Instant;

/** Whether cancelling now is free (RIDE-07). */
public record CancellationQuoteDto(
    boolean free, BigDecimal fee, String currency, Instant graceEndsAt) {}
