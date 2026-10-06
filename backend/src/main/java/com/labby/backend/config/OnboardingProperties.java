package com.labby.backend.config;

import java.time.ZoneId;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Driver onboarding (M5, DRV-04).
 *
 * @param timezone the operating timezone whose calendar date is "today" for document expiry (a
 *     document is valid THROUGH its {@code expiresOn}); Asia/Damascus for the launch market
 * @param expiryJobCron cron of the daily document-expiry job (reminders + auto-suspension),
 *     evaluated in {@code timezone}; {@code -} disables the trigger (tests)
 */
@ConfigurationProperties(prefix = "labby.onboarding")
public record OnboardingProperties(String timezone, String expiryJobCron) {

  /**
   * The operating timezone as a zone id.
   *
   * @return the zone
   */
  public ZoneId zoneId() {
    return ZoneId.of(timezone);
  }
}
