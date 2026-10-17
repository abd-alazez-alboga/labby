package com.labby.backend.dto;

import com.labby.backend.enums.ChallengeGoalType;
import com.labby.backend.enums.RideParty;
import java.time.Instant;
import java.util.UUID;

/** A challenge with its participation counters (growth-v1 Challenge, admin views). */
public record ChallengeDto(
    UUID challengeId,
    UUID regionId,
    RideParty role,
    String titleEn,
    String titleAr,
    ChallengeGoalType goalType,
    int goalTarget,
    long rewardPoints,
    Instant startsAt,
    Instant endsAt,
    Instant endedAt,
    long participantCount,
    long completedCount) {}
