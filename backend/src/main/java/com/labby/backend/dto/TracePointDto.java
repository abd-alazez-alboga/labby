package com.labby.backend.dto;

import com.labby.backend.enums.TracePhase;
import java.time.Instant;

/** One stored GPS point of a ride (TRK-03). */
public record TracePointDto(double lat, double lng, Instant recordedAt, TracePhase phase) {}
