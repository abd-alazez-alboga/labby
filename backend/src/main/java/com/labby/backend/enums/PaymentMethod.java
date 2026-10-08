package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** How a ride is paid (PAY-02); {@code wallet} is refused until M8. */
public enum PaymentMethod {
  CASH("cash"),
  WALLET("wallet");

  private final String value;

  PaymentMethod(String value) {
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
  public static PaymentMethod fromValue(String value) {
    for (PaymentMethod candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown PaymentMethod value: " + value);
  }
}
