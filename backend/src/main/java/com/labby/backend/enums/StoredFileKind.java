package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * What a private upload is for (NFR-S2); PDFs are accepted for documents only. Report photos (M11,
 * REP-01) come only through {@code /report-files}.
 */
public enum StoredFileKind {
  DOCUMENT("document"),
  VEHICLE_PHOTO("vehicle_photo"),
  REPORT_PHOTO("report_photo");

  private final String value;

  StoredFileKind(String value) {
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
  public static StoredFileKind fromValue(String value) {
    for (StoredFileKind candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown StoredFileKind value: " + value);
  }
}
