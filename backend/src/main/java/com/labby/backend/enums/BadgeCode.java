package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * The fixed badge catalog (GAME-01, owner 2026-10-18), mirrored by the V24 {@code badges} seed in
 * this order. Display names live in the apps' i18n by code.
 */
public enum BadgeCode {
  RIDE_10("ride_10"),
  RIDE_50("ride_50"),
  RIDE_100("ride_100"),
  FIRST_SHARED_RIDE("first_shared_ride"),
  FIRST_REFERRAL("first_referral"),
  FIVE_STAR_WEEK("five_star_week");

  private final String value;

  BadgeCode(String value) {
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
  public static BadgeCode fromValue(String value) {
    for (BadgeCode candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown BadgeCode value: " + value);
  }
}
