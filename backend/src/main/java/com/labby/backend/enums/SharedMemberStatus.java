package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * A shared-ride party (V19 shared_ride_members): joined, left (pre-dispatch, free), cancelled
 * (post-dispatch, RIDE-07), no_show (UC-D-13 E1) or completed.
 */
public enum SharedMemberStatus {
  JOINED("joined"),
  LEFT("left"),
  CANCELLED("cancelled"),
  NO_SHOW("no_show"),
  COMPLETED("completed");

  private final String value;

  SharedMemberStatus(String value) {
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
  public static SharedMemberStatus fromValue(String value) {
    for (SharedMemberStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown SharedMemberStatus value: " + value);
  }
}
