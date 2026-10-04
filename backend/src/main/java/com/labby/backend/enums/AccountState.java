package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Account-level state; {@code deleted} is a reactivatable domain state (USR-04, USR-07). */
public enum AccountState {
  ACTIVE("active"),
  SUSPENDED("suspended"),
  DELETED("deleted");

  private final String value;

  AccountState(String value) {
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
  public static AccountState fromValue(String value) {
    for (AccountState candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown AccountState value: " + value);
  }
}
