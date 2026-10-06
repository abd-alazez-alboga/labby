package com.labby.backend.dto;

import java.util.List;

/**
 * The document-expiry dashboard (UC-A-12), each list sorted by expiry date ascending.
 *
 * @param horizonDays the upcoming horizon in days
 * @param upcoming current documents expiring within the horizon (not yet expired)
 * @param expired current documents already expired
 */
public record ExpiryDashboardDto(
    int horizonDays, List<ExpiryRowDto> upcoming, List<ExpiryRowDto> expired) {}
