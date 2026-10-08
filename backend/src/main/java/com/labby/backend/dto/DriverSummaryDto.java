package com.labby.backend.dto;

import java.math.BigDecimal;

/** What the rider sees of the driver from acceptance on (UC-R-05). */
public record DriverSummaryDto(
    String firstName, String photoUrl, BigDecimal rating, VehicleSummaryDto vehicle) {}
