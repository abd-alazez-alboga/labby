package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** How a promo discounts (GRW-01, growth-v1 Promo): a percent of the fare, or a fixed amount. */
public enum PromoType {
  PERCENT("percent"),
  FIXED("fixed");

  private final String value;

  PromoType(String value) {
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
  public static PromoType fromValue(String value) {
    for (PromoType candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown PromoType value: " + value);
  }
}
