package com.labby.backend.dto;

import com.labby.backend.enums.ApplicationStatus;
import java.time.Instant;

/**
 * One stage change of a driver application (UC-D-03 history).
 *
 * @param fromStatus the previous stage, null for the first submission
 * @param toStatus the new stage
 * @param note the stage note (overall change-request note, rejection reason), or null
 * @param at when it happened
 */
public record ApplicationEventDto(
    ApplicationStatus fromStatus, ApplicationStatus toStatus, String note, Instant at) {}
