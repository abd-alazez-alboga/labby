package com.labby.backend.util;

import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.Collection;

/**
 * Region-local day/time windows (surcharge windows PRC-01, peak-hour windows DRV-08): ISO days of
 * week and a start/end time; an end before the start runs past midnight, its early-morning part
 * belonging to the window that started the day before. Equal start and end cover the whole day.
 */
public final class TimeWindows {

  private TimeWindows() {}

  /**
   * Whether the window covers the local moment (start inclusive, end exclusive).
   *
   * @param daysOfWeek the ISO days the window starts on
   * @param start the start time
   * @param end the end time
   * @param local the moment in the region's zone
   * @return true when covered
   */
  public static boolean covers(
      Collection<Integer> daysOfWeek, LocalTime start, LocalTime end, ZonedDateTime local) {
    LocalTime time = local.toLocalTime();
    int today = local.getDayOfWeek().getValue();
    int yesterday = local.getDayOfWeek().minus(1).getValue();
    if (start.equals(end)) {
      return daysOfWeek.contains(today);
    }
    if (start.isBefore(end)) {
      return daysOfWeek.contains(today) && !time.isBefore(start) && time.isBefore(end);
    }
    return (daysOfWeek.contains(today) && !time.isBefore(start))
        || (daysOfWeek.contains(yesterday) && time.isBefore(end));
  }
}
