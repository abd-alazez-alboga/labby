package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * The LOST-02 case state machine: reported -> driver_contacted -> found | not_found; found ->
 * returned; returned | not_found -> closed.
 */
public enum CaseStatus {
  REPORTED("reported"),
  DRIVER_CONTACTED("driver_contacted"),
  FOUND("found"),
  NOT_FOUND("not_found"),
  RETURNED("returned"),
  CLOSED("closed");

  private final String value;

  /**
   * Whether an admin may progress a case from this status to {@code target} (support-v1 header):
   * reported -> driver_contacted -> found | not_found; found -> returned; returned | not_found ->
   * closed. {@code closed} is terminal.
   *
   * @param target the requested case status
   * @return true when the transition is legal
   */
  public boolean canMoveTo(CaseStatus target) {
    return switch (this) {
      case REPORTED -> target == DRIVER_CONTACTED;
      case DRIVER_CONTACTED -> target == FOUND || target == NOT_FOUND;
      case FOUND -> target == RETURNED;
      case NOT_FOUND, RETURNED -> target == CLOSED;
      case CLOSED -> false;
    };
  }

  /**
   * The ticket status that mirrors this case status (LOST-02; V26 ck_support_tickets_case_closed).
   *
   * @return reported = open, driver_contacted / found = in_progress, not_found / returned =
   *     resolved, closed = closed
   */
  public TicketStatus ticketStatus() {
    return switch (this) {
      case REPORTED -> TicketStatus.OPEN;
      case DRIVER_CONTACTED, FOUND -> TicketStatus.IN_PROGRESS;
      case NOT_FOUND, RETURNED -> TicketStatus.RESOLVED;
      case CLOSED -> TicketStatus.CLOSED;
    };
  }

  CaseStatus(String value) {
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
  public static CaseStatus fromValue(String value) {
    for (CaseStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown CaseStatus value: " + value);
  }
}
