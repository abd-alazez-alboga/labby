package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Platform of a registered FCM token (ES-03). */
public enum DevicePlatform {
  ANDROID("android"),
  IOS("ios"),
  WEB("web");

  private final String value;

  DevicePlatform(String value) {
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
  public static DevicePlatform fromValue(String value) {
    for (DevicePlatform candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown DevicePlatform value: " + value);
  }
}
