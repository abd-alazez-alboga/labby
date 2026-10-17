package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Typed points movements (GRW-04, GAME-02; V24 sign checks): ride accrual and challenge rewards are
 * positive, a redemption is negative and linked to its wallet credit, an adjustment is admin-made.
 */
public enum PointsTransactionType {
  ACCRUAL("accrual"),
  REDEMPTION("redemption"),
  CHALLENGE("challenge"),
  ADJUSTMENT("adjustment");

  private final String value;

  PointsTransactionType(String value) {
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
  public static PointsTransactionType fromValue(String value) {
    for (PointsTransactionType candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown PointsTransactionType value: " + value);
  }
}
