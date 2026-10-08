package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** The rider's matching toggle (UC-R-03, owner decision 2026-10-07): one exclusive setting. */
public enum PickupDistanceMode {
  NEARBY_ONLY("nearby_only"),
  ACCEPT_DISTANT_FEE("accept_distant_fee");

  private final String value;

  PickupDistanceMode(String value) {
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
  public static PickupDistanceMode fromValue(String value) {
    for (PickupDistanceMode candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown PickupDistanceMode value: " + value);
  }
}
