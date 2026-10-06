package com.labby.backend.service;

import com.labby.backend.config.OnboardingProperties;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.springframework.stereotype.Component;

/**
 * The onboarding time source (DRV-04): "now" from the application {@link Clock} and "today" as the
 * operating timezone's calendar date ({@code labby.onboarding.timezone}). A document is valid
 * THROUGH its {@code expiresOn}; it is expired once {@link #today()} is later. Every onboarding
 * time rule reads time here, so tests control it through the {@code Clock} bean.
 */
@Component
public class OperatingCalendar {

  private final Clock clock;
  private final ZoneId zone;

  public OperatingCalendar(Clock clock, OnboardingProperties onboardingProperties) {
    this.clock = clock;
    this.zone = onboardingProperties.zoneId();
  }

  /**
   * The current instant.
   *
   * @return now
   */
  public Instant now() {
    return clock.instant();
  }

  /**
   * Today's date in the operating timezone.
   *
   * @return today
   */
  public LocalDate today() {
    return LocalDate.ofInstant(clock.instant(), zone);
  }
}
