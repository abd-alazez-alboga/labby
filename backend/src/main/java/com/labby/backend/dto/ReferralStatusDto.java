package com.labby.backend.dto;

import com.labby.backend.enums.ReferralStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The caller's referral picture (growth-v1 ReferralStatus): their share code (created on first
 * read), the code they entered as a referee, their referees — status only, never phones — and, when
 * a region was named, that region's reward amounts.
 */
public record ReferralStatusDto(
    String code, String enteredCode, List<RefereeDto> referees, RewardDto reward) {

  /** One referee row, newest first. */
  public record RefereeDto(
      String firstName, ReferralStatus status, Instant createdAt, Instant rewardedAt) {}

  /** The named region's referral reward, both sides, in the region currency. */
  public record RewardDto(
      UUID regionId, String currency, BigDecimal referrerAmount, BigDecimal refereeAmount) {}
}
