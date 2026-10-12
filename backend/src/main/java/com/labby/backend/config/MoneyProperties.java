package com.labby.backend.config;

import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The M8 money rails (money-v1.yaml; SRS COM-02/03 defaults).
 *
 * @param floorWarningMargin a driver balance within this much above the region floor is status
 *     {@code warning} (COM-03; default 10)
 * @param commissionRecalcCron the weekly commission recalc tick (COM-02; default early Monday; "-"
 *     disables)
 */
@ConfigurationProperties(prefix = "labby.money")
public record MoneyProperties(BigDecimal floorWarningMargin, String commissionRecalcCron) {}
