package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Which client's notification center lists a notification; {@code all} = every client of the
 * account.
 */
public enum NotificationAudience {
  ALL("all"),
  RIDER("rider"),
  DRIVER("driver"),
  ADMIN("admin");

  private final String value;

  NotificationAudience(String value) {
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
  public static NotificationAudience fromValue(String value) {
    for (NotificationAudience candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown NotificationAudience value: " + value);
  }
}
