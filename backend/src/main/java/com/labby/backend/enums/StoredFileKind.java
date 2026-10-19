package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * What a private upload is for (NFR-S2); PDFs are accepted for documents and ticket attachments
 * only. Report photos (M11, REP-01) come only through {@code /report-files}; ticket attachments and
 * lost-item photos (M14, SUP-01 / LOST-01) only through {@code /ticket-files}.
 */
public enum StoredFileKind {
  DOCUMENT("document"),
  VEHICLE_PHOTO("vehicle_photo"),
  REPORT_PHOTO("report_photo"),
  TICKET_ATTACHMENT("ticket_attachment"),
  LOST_ITEM_PHOTO("lost_item_photo");

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
