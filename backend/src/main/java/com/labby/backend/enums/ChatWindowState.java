package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * A chat thread's derived window state (CHAT-01, comms-v1.yaml). {@code none} never reaches the
 * wire — it is the 404 on the thread endpoints. The state is computed from {@code closed_at} and
 * {@code reopened_until}, never stored.
 */
public enum ChatWindowState {
  OPEN("open"),
  READ_ONLY("read_only"),
  REOPENED("reopened");

  private final String value;

  ChatWindowState(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }

  /**
   * Whether writes (messages, click-to-dial phone) are allowed in this state.
   *
   * @return true for open and reopened
   */
  public boolean writable() {
    return this != READ_ONLY;
  }
}
