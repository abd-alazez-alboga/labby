package com.labby.backend.dto;

import com.labby.backend.enums.RideParty;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * The caller's own per-role average, exposed view (RATE-02): the daily snapshot, null below 5
 * ratings.
 *
 * @param role rider or driver
 * @param average snapshot average (2 decimals), or null below 5 ratings
 * @param ratingCount ratings as of the snapshot (0 without one)
 * @param snapshotAt when the snapshot was computed, or null
 */
public record OwnRatingAggregateDto(
    RideParty role, BigDecimal average, int ratingCount, Instant snapshotAt) {}
