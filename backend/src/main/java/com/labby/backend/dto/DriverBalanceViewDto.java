package com.labby.backend.dto;

import java.util.List;

/** Balances, floor standing and commission tier (money-v1 DriverBalanceView, UC-D-16). */
public record DriverBalanceViewDto(
    List<DriverBalanceEntryDto> balances, CommissionStatusDto commission) {}
