package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Outcome of registration OTP verification: a fresh signup or a deleted-account reactivation
 * (USR-07).
 */
public enum RegistrationMode {
  NEW("new"),
  REACTIVATED("reactivated");

  private final String value;

  RegistrationMode(String value) {
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
  public static RegistrationMode fromValue(String value) {
    for (RegistrationMode candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown RegistrationMode value: " + value);
  }
}
