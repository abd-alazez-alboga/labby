package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** How a shared ride departs (RIDE-P1): at a set time, or when every seat is taken. */
public enum SharedDepartureMode {
  AT_TIME("at_time"),
  WHEN_FULL("when_full");

  private final String value;

  SharedDepartureMode(String value) {
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
  public static SharedDepartureMode fromValue(String value) {
    for (SharedDepartureMode candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown SharedDepartureMode value: " + value);
  }
}
