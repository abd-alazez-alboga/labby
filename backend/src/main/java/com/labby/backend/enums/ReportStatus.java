package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** REP-02 report lifecycle: {@code open} until resolved exactly once. */
public enum ReportStatus {
  OPEN("open"),
  SUBSTANTIATED("substantiated"),
  UNSUBSTANTIATED("unsubstantiated");

  private final String value;

  ReportStatus(String value) {
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
  public static ReportStatus fromValue(String value) {
    for (ReportStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ReportStatus value: " + value);
  }
}
