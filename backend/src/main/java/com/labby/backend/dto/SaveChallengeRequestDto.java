package com.labby.backend.dto;

import com.labby.backend.enums.ChallengeGoalType;
import com.labby.backend.enums.RideParty;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

/** Create a challenge (growth-v1 SaveChallengeRequest; UC-A-28). */
public record SaveChallengeRequestDto(
    @NotNull UUID regionId,
    @NotNull RideParty role,
    @NotBlank @Size(max = 120) String titleEn,
    @NotBlank @Size(max = 120) String titleAr,
    @NotNull ChallengeGoalType goalType,
    @NotNull @Min(1) Integer goalTarget,
    @NotNull @Min(1) Long rewardPoints,
    @NotNull Instant startsAt,
    @NotNull Instant endsAt) {}
