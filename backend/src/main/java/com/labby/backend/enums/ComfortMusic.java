package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Rider comfort preference (UC-R-02): music. */
public enum ComfortMusic {
  NO_PREFERENCE("no_preference"),
  NONE("none"),
  SOFT("soft"),
  ANY("any");

  private final String value;

  ComfortMusic(String value) {
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
  public static ComfortMusic fromValue(String value) {
    for (ComfortMusic candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ComfortMusic value: " + value);
  }
}
