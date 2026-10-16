package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Ride lifecycle (RIDE-02, rides-v1.yaml transition table). {@code scheduled} and {@code gathering}
 * are the M12 pre-live states (scheduled-shared-v1.yaml): no driver, never the rider's active ride.
 */
public enum RideState {
  SCHEDULED("scheduled"),
  GATHERING("gathering"),
  REQUESTED("requested"),
  OFFERING("offering"),
  ACCEPTED("accepted"),
  DRIVER_ARRIVED("driver_arrived"),
  IN_PROGRESS("in_progress"),
  COMPLETED("completed"),
  CANCELLED_BY_RIDER("cancelled_by_rider"),
  CANCELLED_BY_DRIVER("cancelled_by_driver"),
  NO_DRIVER_FOUND("no_driver_found");

  private final String value;

  RideState(String value) {
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
  public static RideState fromValue(String value) {
    for (RideState candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown RideState value: " + value);
  }
}
