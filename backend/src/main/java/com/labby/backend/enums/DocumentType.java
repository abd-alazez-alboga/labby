package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** The four driver documents (DRV-01); registration and insurance belong to a vehicle. */
public enum DocumentType {
  GOVERNMENT_ID("government_id"),
  DRIVERS_LICENSE("drivers_license"),
  VEHICLE_REGISTRATION("vehicle_registration"),
  INSURANCE("insurance");

  private final String value;

  DocumentType(String value) {
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
  public static DocumentType fromValue(String value) {
    for (DocumentType candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown DocumentType value: " + value);
  }
}
