package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Rider comfort preference (UC-R-02): conversation level. */
public enum ComfortConversation {
  NO_PREFERENCE("no_preference"),
  QUIET("quiet"),
  CHATTY("chatty");

  private final String value;

  ComfortConversation(String value) {
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
  public static ComfortConversation fromValue(String value) {
    for (ComfortConversation candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ComfortConversation value: " + value);
  }
}
