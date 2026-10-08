package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Rider comfort preference (UC-R-02): cabin temperature. */
public enum ComfortTemperature {
  NO_PREFERENCE("no_preference"),
  COOL("cool"),
  NORMAL("normal"),
  WARM("warm");

  private final String value;

  ComfortTemperature(String value) {
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
  public static ComfortTemperature fromValue(String value) {
    for (ComfortTemperature candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ComfortTemperature value: " + value);
  }
}
