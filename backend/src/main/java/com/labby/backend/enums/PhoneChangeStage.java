package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Where a phone change in progress stands (ES-02): which phone the last OTP went to. */
public enum PhoneChangeStage {
  AWAITING_CURRENT("awaiting_current"),
  AWAITING_NEW("awaiting_new");

  private final String value;

  PhoneChangeStage(String value) {
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
  public static PhoneChangeStage fromValue(String value) {
    for (PhoneChangeStage candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown PhoneChangeStage value: " + value);
  }
}
