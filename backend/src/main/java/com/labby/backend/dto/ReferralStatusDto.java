package com.labby.backend.dto;

import com.labby.backend.enums.ReferralStatus;
import java.time.Instant;
import java.util.List;

/**
 * The caller's referral picture (growth-v1 ReferralStatus): their share code (created on first
 * read), the code they entered as a referee, and their referees — status only, never phones.
 */
public record ReferralStatusDto(String code, String enteredCode, List<RefereeDto> referees) {

  /** One referee row, newest first. */
  public record RefereeDto(
      String firstName, ReferralStatus status, Instant createdAt, Instant rewardedAt) {}
}
