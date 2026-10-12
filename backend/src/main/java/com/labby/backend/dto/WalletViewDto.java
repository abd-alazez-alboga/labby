package com.labby.backend.dto;

import java.util.List;

/** A wallet: per-currency balances and pending dues (money-v1 WalletView, UC-R-17). */
public record WalletViewDto(List<WalletBalanceDto> balances, List<RiderDueDto> dues) {}
