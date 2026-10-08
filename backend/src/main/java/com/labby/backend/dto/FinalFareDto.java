package com.labby.backend.dto;

/** The stored fare of a completed ride (PRC-04). */
public record FinalFareDto(
    long distanceMeters, long durationSeconds, FareComponentsDto components) {}
