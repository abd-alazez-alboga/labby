package com.labby.backend.service;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

/**
 * RIDE-S timing rules (scheduled-shared-v1.yaml, SRS §9): a region's {@code scheduledSettings}
 * resolved against the defaults, and the moments derived from a pickup time. Pure.
 */
public final class ScheduledRules {

  /** SRS §9 defaults: 24 h + 1 h reminders, 15 min fallback lead, 30 min earliest booking. */
  public static final Settings DEFAULTS = new Settings(1440, 60, 15, 30);

  private ScheduledRules() {}

  /**
   * The timing of a region; null or incomplete JSON = the defaults.
   *
   * @param scheduledSettings the region's JSON (may be null)
   * @return the settings
   */
  public static Settings settings(Map<String, Object> scheduledSettings) {
    if (scheduledSettings == null) {
      return DEFAULTS;
    }
    Integer first = integer(scheduledSettings.get("reminderFirstMin"));
    Integer second = integer(scheduledSettings.get("reminderSecondMin"));
    Integer fallback = integer(scheduledSettings.get("fallbackLeadMin"));
    Integer minLead = integer(scheduledSettings.get("minLeadMin"));
    if (first == null || second == null || fallback == null || minLead == null) {
      return DEFAULTS;
    }
    return new Settings(first, second, fallback, minLead);
  }

  /**
   * Whether settings respect the ordering rule (regions-v1 ScheduledSettings): reminderFirstMin >
   * reminderSecondMin > fallbackLeadMin and minLeadMin > fallbackLeadMin.
   *
   * @param settings the settings
   * @return true when valid
   */
  public static boolean ordered(Settings settings) {
    return settings.reminderFirstMin() > settings.reminderSecondMin()
        && settings.reminderSecondMin() > settings.fallbackLeadMin()
        && settings.minLeadMin() > settings.fallbackLeadMin();
  }

  private static Integer integer(Object value) {
    if (value instanceof Number number) {
      return number.intValue();
    }
    if (value instanceof String text) {
      try {
        return new BigDecimal(text).intValue();
      } catch (NumberFormatException ex) {
        return null;
      }
    }
    return null;
  }

  /**
   * A region's scheduled-ride timing, in minutes before the pickup.
   *
   * @param reminderFirstMin the first reminder tier (default 1440)
   * @param reminderSecondMin the second reminder tier (default 60)
   * @param fallbackLeadMin conversion of a claimed ride / fallback of an unclaimed one (default 15)
   * @param minLeadMin the earliest bookable lead (default 30)
   */
  public record Settings(
      int reminderFirstMin, int reminderSecondMin, int fallbackLeadMin, int minLeadMin) {

    /**
     * The conversion / fallback moment of a pickup.
     *
     * @param scheduledAt the pickup time
     * @return T − fallback lead
     */
    public Instant executeAt(Instant scheduledAt) {
      return scheduledAt.minus(Duration.ofMinutes(fallbackLeadMin));
    }

    /**
     * The first reminder moment.
     *
     * @param scheduledAt the pickup time
     * @return T − first tier
     */
    public Instant firstReminderAt(Instant scheduledAt) {
      return scheduledAt.minus(Duration.ofMinutes(reminderFirstMin));
    }

    /**
     * The second reminder moment.
     *
     * @param scheduledAt the pickup time
     * @return T − second tier
     */
    public Instant secondReminderAt(Instant scheduledAt) {
      return scheduledAt.minus(Duration.ofMinutes(reminderSecondMin));
    }

    /**
     * Whether a pickup time is far enough ahead to book (UC-R-10 E1).
     *
     * @param scheduledAt the requested pickup
     * @param now the moment
     * @return true when at least the minimum lead ahead
     */
    public boolean bookable(Instant scheduledAt, Instant now) {
      return !scheduledAt.isBefore(now.plus(Duration.ofMinutes(minLeadMin)));
    }
  }
}
