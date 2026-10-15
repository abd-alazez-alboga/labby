package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * REP-01 report categories, per direction (trust-v1.yaml): rider to driver {@code unsafe_driving},
 * {@code inappropriate_behavior}, {@code vehicle_condition}, {@code other}; driver to rider {@code
 * unsafe_behavior}, {@code inappropriate_behavior}, {@code vehicle_damage}, {@code other}.
 */
public enum ReportCategory {
  UNSAFE_DRIVING("unsafe_driving"),
  UNSAFE_BEHAVIOR("unsafe_behavior"),
  INAPPROPRIATE_BEHAVIOR("inappropriate_behavior"),
  VEHICLE_CONDITION("vehicle_condition"),
  VEHICLE_DAMAGE("vehicle_damage"),
  OTHER("other");

  private final String value;

  ReportCategory(String value) {
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
  public static ReportCategory fromValue(String value) {
    for (ReportCategory candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ReportCategory value: " + value);
  }
}
