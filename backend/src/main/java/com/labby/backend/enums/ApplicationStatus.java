package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Driver application stages (DRV-02): {@code submitted → under_review → needs_changes → approved /
 * rejected}.
 */
public enum ApplicationStatus {
  SUBMITTED("submitted"),
  UNDER_REVIEW("under_review"),
  NEEDS_CHANGES("needs_changes"),
  APPROVED("approved"),
  REJECTED("rejected");

  private final String value;

  ApplicationStatus(String value) {
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
  public static ApplicationStatus fromValue(String value) {
    for (ApplicationStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ApplicationStatus value: " + value);
  }
}
