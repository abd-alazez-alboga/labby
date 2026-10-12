package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Collection state of a carried rider charge (owner ruling (a)): {@code pending} until the rider's
 * next completed ride collects it, then {@code collected} (at most once).
 */
public enum RiderDueStatus {
  PENDING("pending"),
  COLLECTED("collected");

  private final String value;

  RiderDueStatus(String value) {
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
  public static RiderDueStatus fromValue(String value) {
    for (RiderDueStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown RiderDueStatus value: " + value);
  }
}
