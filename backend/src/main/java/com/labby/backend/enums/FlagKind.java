package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Why an account is on the flagged-accounts queue (UC-A-16): RATE-03, DRV-07, REP-03. */
public enum FlagKind {
  LOW_RATING("low_rating"),
  METRIC_WARNING("metric_warning"),
  REPORT_THRESHOLD("report_threshold");

  private final String value;

  FlagKind(String value) {
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
  public static FlagKind fromValue(String value) {
    for (FlagKind candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown FlagKind value: " + value);
  }
}
