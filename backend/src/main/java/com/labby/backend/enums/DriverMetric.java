package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** The DRV-07 warning metrics. */
public enum DriverMetric {
  ACCEPTANCE("acceptance"),
  CANCELLATION("cancellation");

  private final String value;

  DriverMetric(String value) {
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
  public static DriverMetric fromValue(String value) {
    for (DriverMetric candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown DriverMetric value: " + value);
  }
}
