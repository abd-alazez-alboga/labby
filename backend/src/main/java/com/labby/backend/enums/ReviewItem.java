package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * A reviewable part of a driver application (DRV-02 per-item corrections): the personal details
 * (account name + profile photo), one of the four documents, or the vehicle.
 */
public enum ReviewItem {
  PERSONAL("personal"),
  DOCUMENT("document"),
  VEHICLE("vehicle");

  private final String value;

  ReviewItem(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }

  /**
   * Resolves an enum constant from its lowercase wire value, case-insensitively.
   *
   * @param value the wire value
   * @return the matching constant
   */
  @JsonCreator
  public static ReviewItem fromValue(String value) {
    for (ReviewItem candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ReviewItem value: " + value);
  }
}
