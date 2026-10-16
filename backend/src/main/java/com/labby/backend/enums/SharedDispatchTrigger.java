package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** What dispatched a shared ride (RIDE-P3, transition P2). */
public enum SharedDispatchTrigger {
  CREATOR("creator"),
  FULL("full"),
  DEPARTURE_TIME("departure_time");

  private final String value;

  SharedDispatchTrigger(String value) {
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
  public static SharedDispatchTrigger fromValue(String value) {
    for (SharedDispatchTrigger candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown SharedDispatchTrigger value: " + value);
  }
}
