package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Why a ride was cancelled (RIDE-07). Rider and driver each pick from their own subset. */
public enum CancellationReason {
  CHANGED_MIND("changed_mind"),
  DRIVER_TOO_FAR("driver_too_far"),
  WRONG_PICKUP("wrong_pickup"),
  RIDER_NO_SHOW("rider_no_show"),
  VEHICLE_ISSUE("vehicle_issue"),
  UNSAFE_PICKUP("unsafe_pickup"),
  OTHER("other"),
  /**
   * M11 (review ruling 2026-10-16, USR-06): the system cancelled a pre-acceptance request because
   * an admin suspended the rider's whole account. Never chosen by a party.
   */
  ACCOUNT_SUSPENDED("account_suspended"),
  /** M12: the system cancelled a "when full" shared ride left unfilled for 24 h. */
  SHARED_EXPIRED("shared_expired"),
  /**
   * M12 (ruling 2026-10-16): the system cancelled a scheduled ride whose rider was on another live
   * ride at its conversion/fallback moment.
   */
  RIDER_BUSY("rider_busy");

  private final String value;

  CancellationReason(String value) {
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
  public static CancellationReason fromValue(String value) {
    for (CancellationReason candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown CancellationReason value: " + value);
  }
}
