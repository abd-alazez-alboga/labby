package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Typed wallet ledger entries (PAY-01, money-v1.yaml). Credits are positive ({@code refund}, {@code
 * admin_grant} and the M13 sources), debits negative ({@code fare_payment}, {@code tip}, {@code
 * cancellation_fee}) — the V12 sign CHECK enforces it.
 */
public enum WalletTransactionType {
  FARE_PAYMENT("fare_payment"),
  TIP("tip"),
  CANCELLATION_FEE("cancellation_fee"),
  REFUND("refund"),
  ADMIN_GRANT("admin_grant"),
  REFERRAL("referral"),
  PROMO("promo"),
  LOYALTY_REDEMPTION("loyalty_redemption");

  private final String value;

  WalletTransactionType(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }

  /** Whether entries of this type credit the wallet (positive amounts). */
  public boolean isCredit() {
    return switch (this) {
      case REFUND, ADMIN_GRANT, REFERRAL, PROMO, LOYALTY_REDEMPTION -> true;
      case FARE_PAYMENT, TIP, CANCELLATION_FEE -> false;
    };
  }

  /**
   * Resolves an enum constant from its lowercase wire/db value, case-insensitively.
   *
   * @param value the wire value
   * @return the matching constant
   */
  @JsonCreator
  public static WalletTransactionType fromValue(String value) {
    for (WalletTransactionType candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown WalletTransactionType value: " + value);
  }
}
