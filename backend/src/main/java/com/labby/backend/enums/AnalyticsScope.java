package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** What a dashboard figure covers: signups are always platform-wide (analytics-v1, ruling Q6). */
public enum AnalyticsScope {
  PLATFORM("platform");

  private final String value;

  AnalyticsScope(String value) {
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
  public static AnalyticsScope fromValue(String value) {
    for (AnalyticsScope candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown AnalyticsScope value: " + value);
  }
}
