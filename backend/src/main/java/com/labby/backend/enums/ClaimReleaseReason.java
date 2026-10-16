package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Why a scheduled-ride claim was given back (UC-D-12 E1, scheduled-shared-v1.yaml). The driver
 * picks one of the RIDE-07 reasons that apply before pickup; {@code account_suspended} is the
 * system's release of a suspended driver's claim (never chosen, not a metric event).
 */
public enum ClaimReleaseReason {
  VEHICLE_ISSUE("vehicle_issue"),
  UNSAFE_PICKUP("unsafe_pickup"),
  OTHER("other"),
  ACCOUNT_SUSPENDED("account_suspended");

  private final String value;

  ClaimReleaseReason(String value) {
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
  public static ClaimReleaseReason fromValue(String value) {
    for (ClaimReleaseReason candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ClaimReleaseReason value: " + value);
  }
}
