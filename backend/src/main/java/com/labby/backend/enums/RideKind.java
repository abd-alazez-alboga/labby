package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** What kind of ride (SD; scheduled + shared arrive in M12/M13). */
public enum RideKind {
  ON_DEMAND("on_demand"),
  SCHEDULED("scheduled"),
  SHARED("shared");

  private final String value;

  RideKind(String value) {
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
  public static RideKind fromValue(String value) {
    for (RideKind candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown RideKind value: " + value);
  }
}
