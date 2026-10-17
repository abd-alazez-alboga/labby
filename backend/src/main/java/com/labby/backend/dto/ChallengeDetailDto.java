package com.labby.backend.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** One challenge with one page of its participation (growth-v1 ChallengeDetail). */
public record ChallengeDetailDto(ChallengeDto challenge, ParticipationPageDto participation) {

  /** One participant's progress. */
  public record ParticipantDto(
      UUID userId, String userName, int progress, boolean completed, Instant completedAt) {}

  /** One page of participants, furthest along first. */
  public record ParticipationPageDto(
      List<ParticipantDto> items, int page, int size, long totalItems) {}
}
