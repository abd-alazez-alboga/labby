package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * A support ticket's kind (SUP-01, LOST-02): a plain ticket, or a lost-item case (support-v1.yaml).
 */
public enum TicketKind {
  TICKET("ticket"),
  LOST_ITEM("lost_item");

  private final String value;

  TicketKind(String value) {
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
  public static TicketKind fromValue(String value) {
    for (TicketKind candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown TicketKind value: " + value);
  }
}
