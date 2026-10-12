package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * COM-03 floor standing of a driver balance: {@code warning} within the configured margin above the
 * floor, {@code blocked} at or below it (no new offers until settlement), else {@code ok}.
 */
public enum FloorStatus {
  OK("ok"),
  WARNING("warning"),
  BLOCKED("blocked");

  private final String value;

  FloorStatus(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }
}
