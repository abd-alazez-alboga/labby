package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Lifetime-points levels (GAME-03; owner 2026-10-18): Bronze 0 / Silver 500 / Gold 2,000 / Platinum
 * 5,000. Levels derive from {@code lifetime}, which only ever grows, so they never decrease on
 * redemption. Riders count loyalty earned; drivers trips + challenge points.
 */
public enum GrowthLevel {
  BRONZE("bronze", 0),
  SILVER("silver", 500),
  GOLD("gold", 2_000),
  PLATINUM("platinum", 5_000);

  private final String value;
  private final long thresholdPoints;

  GrowthLevel(String value, long thresholdPoints) {
    this.value = value;
    this.thresholdPoints = thresholdPoints;
  }

  @JsonValue
  public String getValue() {
    return value;
  }

  public long getThresholdPoints() {
    return thresholdPoints;
  }

  /**
   * The level a lifetime-points balance sits in.
   *
   * @param lifetime the lifetime points
   * @return the highest level whose threshold is reached
   */
  public static GrowthLevel of(long lifetime) {
    GrowthLevel level = BRONZE;
    for (GrowthLevel candidate : values()) {
      if (lifetime >= candidate.thresholdPoints) {
        level = candidate;
      }
    }
    return level;
  }
}
