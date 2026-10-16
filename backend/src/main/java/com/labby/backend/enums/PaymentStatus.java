package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Payment of a completed ride (UC-D-09; PAY-02 from M8): {@code paid_wallet} = fare fully covered
 * by the wallet at completion (auto-confirmed), {@code paid_mixed} = wallet drained + cash
 * remainder confirmed by the driver. {@code split} (M12) = a completed shared ride, paid per
 * member.
 */
public enum PaymentStatus {
  PENDING("pending"),
  PAID_CASH("paid_cash"),
  PAID_WALLET("paid_wallet"),
  PAID_MIXED("paid_mixed"),
  UNPAID("unpaid"),
  SPLIT("split");

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
