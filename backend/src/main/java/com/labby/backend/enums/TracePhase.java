package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Which leg a ride trace sample belongs to (TRK-03): metering uses {@code in_ride} only. */
public enum TracePhase {
  TO_PICKUP("to_pickup"),
  IN_RIDE("in_ride");

  private final String value;

  TracePhase(String value) {
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
  public static TracePhase fromValue(String value) {
    for (TracePhase candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown TracePhase value: " + value);
  }
}
