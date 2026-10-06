package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Why a driver may not go online (UC-D-04 E1, realtime-v1.yaml {@code DriverAvailability}). */
public enum CannotGoOnlineReason {
  ROLE_SUSPENDED("role_suspended"),
  NOT_APPROVED("not_approved"),
  NO_ACTIVE_VEHICLE("no_active_vehicle");

  private final String value;

  CannotGoOnlineReason(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }

  /**
   * Resolves an enum constant from its lowercase wire value, case-insensitively.
   *
   * @param value the wire value
   * @return the matching constant
   */
  @JsonCreator
  public static CannotGoOnlineReason fromValue(String value) {
    for (CannotGoOnlineReason candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown CannotGoOnlineReason value: " + value);
  }
}
