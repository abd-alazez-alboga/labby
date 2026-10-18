package com.labby.backend.service;

import com.labby.backend.dto.ReferralStatusDto;
import java.util.UUID;

/** Referrals (GRW-03, growth-v1 Referrals; UC-R-18). */
public interface ReferralService {

  /**
   * The caller's share code (created on first read), entered code and referees.
   *
   * @param userId the caller
   * @param regionId the region whose reward amounts to include, or null for none
   * @return the status
   */
  ReferralStatusDto me(UUID userId, UUID regionId);

  /**
   * Captures a referral code, once, before any completed ride (abuse blocks: self, phone-ever,
   * too-late).
   *
   * @param userId the referee
   * @param code the referrer's share code
   * @return the referee's status after the capture
   */
  ReferralStatusDto enter(UUID userId, String code);
}
