package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** A ticket history entry's type (SUP-02 status/history in-app; V26 ticket_events). */
public enum TicketEventType {
  CREATED("created"),
  STATUS_CHANGED("status_changed"),
  PRIORITY_CHANGED("priority_changed"),
  ASSIGNED("assigned"),
  CASE_STATUS_CHANGED("case_status_changed"),
  REMINDER_SENT("reminder_sent");

  private final String value;

  TicketEventType(String value) {
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
  public static TicketEventType fromValue(String value) {
    for (TicketEventType candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown TicketEventType value: " + value);
  }
}
