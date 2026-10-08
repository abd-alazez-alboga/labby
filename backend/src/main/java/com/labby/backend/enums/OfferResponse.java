package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** How an offer ended (RIDE-03 trail); {@code withdrawn} does not count against the driver. */
public enum OfferResponse {
  ACCEPTED("accepted"),
  DECLINED("declined"),
  TIMEOUT("timeout"),
  WITHDRAWN("withdrawn");

  private final String value;

  OfferResponse(String value) {
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
  public static OfferResponse fromValue(String value) {
    for (OfferResponse candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown OfferResponse value: " + value);
  }
}
