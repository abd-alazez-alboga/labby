package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Region lifecycle (UC-A-05): a region stays a draft until its mandatory config bundle is complete,
 * then an admin activates it. Activation completeness is enforced in the service layer (M4-T2).
 */
public enum RegionState {
  DRAFT("draft"),
  ACTIVE("active");

  private final String value;

  RegionState(String value) {
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
  public static RegionState fromValue(String value) {
    for (RegionState candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown RegionState value: " + value);
  }
}
