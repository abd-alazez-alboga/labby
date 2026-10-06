package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Push outcome of a notification-center row; a failed or muted push never loses the row (NFR-A3).
 */
public enum PushStatus {
  PENDING("pending"),
  SENT("sent"),
  MUTED("muted"),
  NO_DEVICE("no_device"),
  FAILED("failed");

  private final String value;

  PushStatus(String value) {
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
  public static PushStatus fromValue(String value) {
    for (PushStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown PushStatus value: " + value);
  }
}
