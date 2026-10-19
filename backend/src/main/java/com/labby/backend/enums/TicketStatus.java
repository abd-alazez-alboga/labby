package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * The SUP-02 ticket state machine: open -> in_progress -> waiting_on_user -> resolved -> closed.
 */
public enum TicketStatus {
  OPEN("open"),
  IN_PROGRESS("in_progress"),
  WAITING_ON_USER("waiting_on_user"),
  RESOLVED("resolved"),
  CLOSED("closed");

  private final String value;

  /**
   * Whether an admin may move a plain ticket from this status to {@code target} (support-v1
   * header): open -> in_progress; in_progress -> waiting_on_user | resolved; waiting_on_user ->
   * in_progress; resolved -> in_progress | closed. {@code closed} is terminal.
   *
   * @param target the requested status
   * @return true when the transition is legal
   */
  public boolean canMoveTo(TicketStatus target) {
    return switch (this) {
      case OPEN -> target == IN_PROGRESS;
      case IN_PROGRESS -> target == WAITING_ON_USER || target == RESOLVED;
      case WAITING_ON_USER -> target == IN_PROGRESS;
      case RESOLVED -> target == IN_PROGRESS || target == CLOSED;
      case CLOSED -> false;
    };
  }

  TicketStatus(String value) {
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
  public static TicketStatus fromValue(String value) {
    for (TicketStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown TicketStatus value: " + value);
  }
}
