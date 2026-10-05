package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/**
 * An admin-defined time-window fare surcharge (PRC-01). Times are region-local; days are ISO day
 * numbers, 1 = Monday … 7 = Sunday.
 */
public record SurchargeWindowDto(
    UUID id,
    UUID regionId,
    String label,
    LocalTime startsAt,
    LocalTime endsAt,
    List<Integer> daysOfWeek,
    BigDecimal percent) {}
