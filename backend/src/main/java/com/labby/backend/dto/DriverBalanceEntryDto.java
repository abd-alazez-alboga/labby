package com.labby.backend.dto;

import com.labby.backend.enums.FloorStatus;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * One per-currency driver balance with its floor standing (money-v1, COM-03). {@code floorRegionId}
 * / {@code floorRegionName} name the operating region whose floor applies (the admin ledger card's
 * "Floor · Damascus"); both null when the SRS default floor applies.
 */
public record DriverBalanceEntryDto(
    String currency,
    BigDecimal balance,
    BigDecimal floor,
    FloorStatus status,
    UUID floorRegionId,
    String floorRegionName) {}
