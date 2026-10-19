package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** A help article's visibility (SUP-04): drafts never reach the apps. */
public enum ArticleStatus {
  DRAFT("draft"),
  PUBLISHED("published");

  private final String value;

  ArticleStatus(String value) {
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
  public static ArticleStatus fromValue(String value) {
    for (ArticleStatus candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ArticleStatus value: " + value);
  }
}
