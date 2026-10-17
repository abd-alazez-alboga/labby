package com.labby.backend.dto;

import com.labby.backend.enums.ChallengeGoalType;
import java.time.Instant;
import java.util.UUID;

/** One challenge with the caller's progress (growth-v1 ChallengeView). */
public record ChallengeViewDto(
    UUID challengeId,
    String titleEn,
    String titleAr,
    ChallengeGoalType goalType,
    int goalTarget,
    long rewardPoints,
    Instant startsAt,
    Instant endsAt,
    boolean ended,
    int myProgress,
    boolean myCompleted) {}
