package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.service.ScheduledRules;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** RIDE-S timing resolution and moments (scheduled-shared-v1, SRS §9 defaults). */
class ScheduledRulesTest {

  private static final Instant PICKUP = Instant.parse("2026-10-20T09:00:00Z");

  @Test
  @DisplayName("null or incomplete region settings fall back to 1440 / 60 / 15 / 30")
  void shouldFallBackToDefaults() {
    assertThat(ScheduledRules.settings(null)).isEqualTo(ScheduledRules.DEFAULTS);
    assertThat(ScheduledRules.settings(Map.of("fallbackLeadMin", 20)))
        .isEqualTo(ScheduledRules.DEFAULTS);
    assertThat(
            ScheduledRules.settings(
                Map.of(
                    "reminderFirstMin", 720,
                    "reminderSecondMin", 30,
                    "fallbackLeadMin", 20,
                    "minLeadMin", 45)))
        .isEqualTo(new ScheduledRules.Settings(720, 30, 20, 45));
  }

  @Test
  @DisplayName("the moments derive from the pickup; the minimum lead is inclusive")
  void shouldDeriveMoments() {
    ScheduledRules.Settings settings = ScheduledRules.DEFAULTS;
    assertThat(settings.executeAt(PICKUP)).isEqualTo(PICKUP.minus(Duration.ofMinutes(15)));
    assertThat(settings.firstReminderAt(PICKUP)).isEqualTo(PICKUP.minus(Duration.ofHours(24)));
    assertThat(settings.secondReminderAt(PICKUP)).isEqualTo(PICKUP.minus(Duration.ofHours(1)));
    assertThat(settings.bookable(PICKUP, PICKUP.minus(Duration.ofMinutes(30)))).isTrue();
    assertThat(settings.bookable(PICKUP, PICKUP.minus(Duration.ofMinutes(29)))).isFalse();
  }

  @Test
  @DisplayName("ordering: first > second > fallback and minLead > fallback")
  void shouldCheckOrdering() {
    assertThat(ScheduledRules.ordered(ScheduledRules.DEFAULTS)).isTrue();
    assertThat(ScheduledRules.ordered(new ScheduledRules.Settings(60, 60, 15, 30))).isFalse();
    assertThat(ScheduledRules.ordered(new ScheduledRules.Settings(1440, 10, 15, 30))).isFalse();
    assertThat(ScheduledRules.ordered(new ScheduledRules.Settings(1440, 60, 15, 15))).isFalse();
  }
}
