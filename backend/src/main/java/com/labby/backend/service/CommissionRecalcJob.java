package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Triggers the weekly commission recalc (COM-02) on {@code labby.money.commission-recalc-cron}
 * ({@code MONEY_COMMISSION_RECALC_CRON}, default early Monday; {@code -} disables). All logic lives
 * in {@link CommissionService}; weeks are evaluated per region time zone.
 */
@Component
@RequiredArgsConstructor
public class CommissionRecalcJob {

  private final CommissionService commissionService;

  /** Runs one recalc pass. */
  @Scheduled(cron = "${labby.money.commission-recalc-cron}")
  public void run() {
    commissionService.recalcWeeklyRates();
  }
}
