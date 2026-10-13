package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** A chat message's kind (CHAT-02): free text or a catalog quick reply. */
public enum ChatMessageKind {
  TEXT("text"),
  QUICK_REPLY("quick_reply");

  private final String value;

  ChatMessageKind(String value) {
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
  public static ChatMessageKind fromValue(String value) {
    for (ChatMessageKind candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ChatMessageKind value: " + value);
  }
}
