package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Client an auth request comes from; login checks the account holds a matching role (AUTH-02). */
public enum ClientType {
  RIDER("rider"),
  DRIVER("driver"),
  ADMIN("admin");

  private final String value;

  ClientType(String value) {
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
  public static ClientType fromValue(String value) {
    for (ClientType candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ClientType value: " + value);
  }
}
