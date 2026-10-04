package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Per-role state — a role can be suspended while the account stays active (USR-04). */
public enum RoleState {
  ACTIVE("active"),
  SUSPENDED("suspended");

  private final String value;

  RoleState(String value) {
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
  public static RoleState fromValue(String value) {
    for (RoleState candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown RoleState value: " + value);
  }
}
