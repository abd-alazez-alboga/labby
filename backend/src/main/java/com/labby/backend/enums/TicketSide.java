package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Who acted or wrote in a ticket: the user side, the support side, or the system (reminder job).
 */
public enum TicketSide {
  USER("user"),
  SUPPORT("support"),
  SYSTEM("system");

  private final String value;

  TicketSide(String value) {
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
  public static TicketSide fromValue(String value) {
    for (TicketSide candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown TicketSide value: " + value);
  }
}
