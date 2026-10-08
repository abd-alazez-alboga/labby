package com.labby.backend.dto;

/** A fare estimate — always labeled as an estimate (RIDE-01). */
public record EstimateDto(
    long distanceMeters, long durationSeconds, boolean approximate, FareComponentsDto components) {}
