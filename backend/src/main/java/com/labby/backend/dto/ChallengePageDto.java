package com.labby.backend.dto;

import java.util.List;

/** One admin page of challenges, newest first. */
public record ChallengePageDto(List<ChallengeDto> items, int page, int size, long totalItems) {}
