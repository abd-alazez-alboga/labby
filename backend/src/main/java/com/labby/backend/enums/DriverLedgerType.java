package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Typed driver ledger entries (COM-01, money-v1.yaml). Credits positive ({@code ride_earning},
 * {@code tip}, {@code cancellation_fee}, {@code settlement_pay_in}, {@code bonus}), debits negative
 * ({@code commission_due}, {@code settlement_pay_out}, {@code due_collection}) — V12 sign CHECK.
 */
public enum DriverLedgerType {
  RIDE_EARNING("ride_earning"),
  COMMISSION_DUE("commission_due"),
  TIP("tip"),
  CANCELLATION_FEE("cancellation_fee"),
  SETTLEMENT_PAY_IN("settlement_pay_in"),
  SETTLEMENT_PAY_OUT("settlement_pay_out"),
  BONUS("bonus"),
  DUE_COLLECTION("due_collection"),
  /** M13 ruling 1: the platform-funded promo discount, credited to the ride's driver (V25). */
  PROMO_COMPENSATION("promo_compensation");

  private final String value;

  DriverLedgerType(String value) {
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
  public static DriverLedgerType fromValue(String value) {
    for (DriverLedgerType candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown DriverLedgerType value: " + value);
  }
}
