package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Which money ledger an admin transactions row comes from (analytics-v1, ruling Q5). */
public enum TransactionSource {
  WALLET("wallet"),
  DRIVER_LEDGER("driver_ledger");

  private final String value;

  TransactionSource(String value) {
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
  public static TransactionSource fromValue(String value) {
    for (TransactionSource candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown TransactionSource value: " + value);
  }
}
