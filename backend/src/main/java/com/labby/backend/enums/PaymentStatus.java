package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Payment of a completed ride (UC-D-09). */
public enum PaymentStatus {
  PENDING("pending"),
  PAID_CASH("paid_cash"),
  UNPAID("unpaid");

  private final String value;

  PaymentStatus(String value) {
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
  public static PaymentStatus fromValue(String value) {
    for (PaymentStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown PaymentStatus value: " + value);
  }
}
