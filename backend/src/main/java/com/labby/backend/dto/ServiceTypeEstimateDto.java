package com.labby.backend.dto;

import java.util.UUID;

/** The estimate of one service type. */
public record ServiceTypeEstimateDto(
    UUID serviceTypeId, String nameEn, String nameAr, EstimateDto estimate) {}
