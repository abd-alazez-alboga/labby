package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * A referral's lifecycle (GRW-03): captured at registration ({@code pending}), paid on the
 * referee's first completed ride ({@code rewarded}), or refused by an abuse block ({@code
 * blocked}).
 */
public enum ReferralStatus {
  PENDING("pending"),
  REWARDED("rewarded"),
  BLOCKED("blocked");

  private final String value;

  ReferralStatus(String value) {
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
  public static ReferralStatus fromValue(String value) {
    for (ReferralStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ReferralStatus value: " + value);
  }
}
