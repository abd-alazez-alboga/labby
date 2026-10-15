package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** The caller's own rating state for a ride (trust-v1.yaml MyRating). */
public enum MyRatingState {
  PENDING("pending"),
  SUBMITTED("submitted"),
  EXPIRED("expired"),
  NOT_APPLICABLE("not_applicable");

  private final String value;

  MyRatingState(String value) {
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
  public static MyRatingState fromValue(String value) {
    for (MyRatingState candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown MyRatingState value: " + value);
  }
}
