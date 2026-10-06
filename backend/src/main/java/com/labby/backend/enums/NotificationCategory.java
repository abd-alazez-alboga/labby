package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Notification categories (NTF-01). {@code ride} and {@code safety} are ride-critical/safety and
 * can never be muted (NTF-02).
 */
public enum NotificationCategory {
  RIDE("ride"),
  CHAT("chat"),
  SCHEDULED("scheduled"),
  PROMOTIONS("promotions"),
  ACCOUNT("account"),
  SAFETY("safety");

  private final String value;

  NotificationCategory(String value) {
    this.value = value;
  }

  /**
   * Whether users may mute this category's push (NTF-02, UC-S-12 E1).
   *
   * @return false for the locked ride-critical and safety categories
   */
  public boolean isMutable() {
    return this != RIDE && this != SAFETY;
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
  public static NotificationCategory fromValue(String value) {
    for (NotificationCategory candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown NotificationCategory value: " + value);
  }
}
