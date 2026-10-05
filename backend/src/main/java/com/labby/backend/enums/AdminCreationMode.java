package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * How admin creation resolved (UC-A-01): a new account with the set-password OTP path, or the admin
 * role granted to the existing account behind the phone (E1).
 */
public enum AdminCreationMode {
  CREATED("created"),
  GRANTED_EXISTING("granted_existing");

  private final String value;

  AdminCreationMode(String value) {
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
  public static AdminCreationMode fromValue(String value) {
    for (AdminCreationMode candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown AdminCreationMode value: " + value);
  }
}
