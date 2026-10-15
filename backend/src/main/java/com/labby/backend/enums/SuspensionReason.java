package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Why a role (or, {@code manual} only, a whole account) is suspended (USR-04..06): DRV-04 document
 * expiry, USR-05 low rating, or an admin action. Only {@code document_expired} is lifted
 * automatically (DRV-04); the others only by an admin reactivation (M11).
 */
public enum SuspensionReason {
  DOCUMENT_EXPIRED("document_expired"),
  LOW_RATING("low_rating"),
  MANUAL("manual");

  private final String value;

  SuspensionReason(String value) {
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
  public static SuspensionReason fromValue(String value) {
    for (SuspensionReason candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown SuspensionReason value: " + value);
  }
}
