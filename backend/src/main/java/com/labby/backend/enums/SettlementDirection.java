package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * The direction of a recorded settlement (COM-04): {@code pay_in} = the driver handed cash (credits
 * the balance), {@code pay_out} = a positive balance was paid out (debits it).
 */
public enum SettlementDirection {
  PAY_IN("pay_in"),
  PAY_OUT("pay_out");

  private final String value;

  SettlementDirection(String value) {
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
  public static SettlementDirection fromValue(String value) {
    for (SettlementDirection candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown SettlementDirection value: " + value);
  }
}
