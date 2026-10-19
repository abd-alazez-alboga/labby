package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Which DRV-08 incentive an award pays (incentives-v1 {@code IncentiveAward.kind}). */
public enum IncentiveKind {
  WEEKLY_TRIPS("weekly_trips"),
  PEAK_HOURS("peak_hours"),
  RATING("rating");

  private final String value;

  IncentiveKind(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }

  /**
   * Resolves an enum constant from its lowercase wire/db value, case-insensitively.
   *
   * @param value the wire value
   * @return the matching constant
   */
  @JsonCreator
  public static IncentiveKind fromValue(String value) {
    for (IncentiveKind candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown IncentiveKind value: " + value);
  }
}
