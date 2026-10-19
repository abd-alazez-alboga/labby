package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** The fixed FDBK-01 feedback catalog (owner ruling 2026-10-19), named in app i18n. */
public enum FeedbackCategory {
  APP_EXPERIENCE("app_experience"),
  PRICING("pricing"),
  DRIVERS("drivers"),
  SAFETY("safety"),
  FEATURE_REQUEST("feature_request"),
  OTHER("other");

  private final String value;

  FeedbackCategory(String value) {
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
  public static FeedbackCategory fromValue(String value) {
    for (FeedbackCategory candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown FeedbackCategory value: " + value);
  }
}
