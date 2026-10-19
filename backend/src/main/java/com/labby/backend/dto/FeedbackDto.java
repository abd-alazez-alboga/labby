package com.labby.backend.dto;

import com.labby.backend.enums.FeedbackCategory;
import com.labby.backend.enums.RideParty;
import java.time.Instant;
import java.util.UUID;

/** A recorded feedback entry (support-v1 {@code Feedback}). */
public record FeedbackDto(
    UUID feedbackId,
    FeedbackCategory category,
    String body,
    RideParty submittedAs,
    Instant createdAt) {}
