package com.labby.backend.dto;

import com.labby.backend.enums.RideParty;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * The caller's own per-role average, exposed view (RATE-02): the snapshot, null below 5 ratings. No
 * count is exposed (review B-W1, owner ruling 2026-10-16): with the exact count, two snapshots
 * would reveal each new score.
 *
 * @param role rider or driver
 * @param average snapshot average (2 decimals), or null below 5 ratings
 * @param snapshotAt when the snapshot was computed, or null
 */
public record OwnRatingAggregateDto(RideParty role, BigDecimal average, Instant snapshotAt) {}
