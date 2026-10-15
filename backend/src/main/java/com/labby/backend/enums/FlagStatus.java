package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** An account flag's state: open until an admin actions or dismisses it with a note. */
public enum FlagStatus {
  OPEN("open"),
  ACTIONED("actioned"),
  DISMISSED("dismissed");

  private final String value;

  FlagStatus(String value) {
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
  public static FlagStatus fromValue(String value) {
    for (FlagStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown FlagStatus value: " + value);
  }
}
