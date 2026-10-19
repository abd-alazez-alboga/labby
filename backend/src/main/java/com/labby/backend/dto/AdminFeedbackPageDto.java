package com.labby.backend.dto;

import java.util.List;

/** One page of feedback, newest first. */
public record AdminFeedbackPageDto(
    List<AdminFeedbackDto> items, int page, int size, long totalItems) {}
