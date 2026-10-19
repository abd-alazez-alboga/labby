package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** The ticket priority scale (SUP-03; owner ruling 2026-10-19), urgent first in the queue. */
public enum TicketPriority {
  LOW("low"),
  NORMAL("normal"),
  HIGH("high"),
  URGENT("urgent");

  private final String value;

  TicketPriority(String value) {
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
  public static TicketPriority fromValue(String value) {
    for (TicketPriority candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown TicketPriority value: " + value);
  }
}
