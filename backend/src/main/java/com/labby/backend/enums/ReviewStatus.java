package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Per-item review state of a document or vehicle (DRV-02 per-item corrections). {@code superseded}
 * applies to documents only (replaced by an approved renewal).
 */
public enum ReviewStatus {
  PENDING("pending"),
  CHANGES_REQUESTED("changes_requested"),
  APPROVED("approved"),
  REJECTED("rejected"),
  SUPERSEDED("superseded");

  private final String value;

  ReviewStatus(String value) {
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
  public static ReviewStatus fromValue(String value) {
    for (ReviewStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ReviewStatus value: " + value);
  }
}
