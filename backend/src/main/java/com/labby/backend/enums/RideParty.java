package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Which party of a ride acted — a chat sender (CHAT-01) or an SOS trigger (SAFE-01). */
public enum RideParty {
  RIDER("rider"),
  DRIVER("driver");

  private final String value;

  RideParty(String value) {
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
  public static RideParty fromValue(String value) {
    for (RideParty candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown RideParty value: " + value);
  }

  /**
   * The other party.
   *
   * @return driver for rider, rider for driver
   */
  public RideParty other() {
    return this == RIDER ? DRIVER : RIDER;
  }
}
