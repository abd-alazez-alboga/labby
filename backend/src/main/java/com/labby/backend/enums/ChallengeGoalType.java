package com.labby.backend.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** What a challenge counts (GAME-02, V24): completed rides, shared rides, or 5-star ratings. */
public enum ChallengeGoalType {
  COMPLETED_RIDES("completed_rides"),
  SHARED_RIDES("shared_rides"),
  FIVE_STAR_RATINGS("five_star_ratings");

  private final String value;

  ChallengeGoalType(String value) {
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
  public static ChallengeGoalType fromValue(String value) {
    for (ChallengeGoalType candidate : values()) {
      if (candidate.value.equalsIgnoreCase(value)) {
        return candidate;
      }
    }
    throw new IllegalArgumentException("Unknown ChallengeGoalType value: " + value);
  }
}
