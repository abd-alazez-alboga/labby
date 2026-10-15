package com.labby.backend.dto;

import com.labby.backend.enums.MyRatingState;
import java.time.Instant;

/**
 * The caller's OWN rating state for a ride (trust-v1 MyRating, rides-v1 {@code Ride.myRating}) —
 * never anything about ratings the caller received.
 *
 * @param state pending / submitted / expired / not_applicable
 * @param windowEndsAt completedAt + 7 days (null when the ride did not complete)
 * @param score the score the caller gave ({@code submitted} only)
 */
public record MyRatingDto(MyRatingState state, Instant windowEndsAt, Integer score) {}
