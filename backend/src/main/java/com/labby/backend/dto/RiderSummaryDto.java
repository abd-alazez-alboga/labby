package com.labby.backend.dto;

import java.math.BigDecimal;

/** What the driver sees of the rider from the offer on (UC-D-06). */
public record RiderSummaryDto(String firstName, BigDecimal rating, ComfortPreferencesDto comfort) {}
