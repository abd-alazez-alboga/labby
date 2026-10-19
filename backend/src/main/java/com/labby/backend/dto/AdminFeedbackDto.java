package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import java.util.List;

/** A feedback entry with its author and tags (support-v1 {@code AdminFeedback}, UC-A-25). */
public record AdminFeedbackDto(
    @JsonUnwrapped FeedbackDto feedback, PartySummaryDto user, List<String> tags) {}
