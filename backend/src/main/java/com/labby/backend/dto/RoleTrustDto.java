package com.labby.backend.dto;

import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RoleState;
import com.labby.backend.enums.SuspensionReason;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * One rider/driver role of a user, admin trust view (UC-A-13/14): state with reason, LIVE average,
 * open flags, active metric warnings (driver only) and report history.
 */
public record RoleTrustDto(
    RideParty role,
    RoleState state,
    SuspensionReason suspensionReason,
    String suspensionNote,
    Instant suspendedAt,
    BigDecimal liveAverage,
    long liveRatingCount,
    List<AccountFlagDto> openFlags,
    List<MetricWarningDto> activeWarnings,
    ReportHistoryDto reportHistory) {}
