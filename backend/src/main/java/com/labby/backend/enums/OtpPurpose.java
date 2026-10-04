package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Operation an OTP was issued for; codes are only valid for their purpose (AUTH-04). */
public enum OtpPurpose {
  REGISTER("register"),
  RESET("reset"),
  TWO_FA("2fa");

  private final String value;

  OtpPurpose(String value) {
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
  public static OtpPurpose fromValue(String value) {
    for (OtpPurpose candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown OtpPurpose value: " + value);
  }
}
