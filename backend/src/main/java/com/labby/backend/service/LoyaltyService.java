package com.labby.backend.service;

import com.labby.backend.dto.LoyaltyBalanceDto;
import com.labby.backend.dto.PointsTransactionPageDto;
import java.util.UUID;

/** Loyalty points (GRW-04, growth-v1 Loyalty; UC-R-19). */
public interface LoyaltyService {

  /**
   * The caller's balance, level ladder and the region redemption rule.
   *
   * @param userId the caller
   * @param regionId the region whose rule to show
   * @return the balance
   */
  LoyaltyBalanceDto balance(UUID userId, UUID regionId);

  /**
   * The caller's points history, newest first.
   *
   * @param userId the caller
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  PointsTransactionPageDto transactions(UUID userId, int page, int size);

  /**
   * Redeems points into a wallet credit at the region's rate (threshold applies; frozen while
   * suspended — ruling 6).
   *
   * @param userId the caller
   * @param regionId the region (rate + currency)
   * @param points the points to redeem
   * @return the balance after
   */
  LoyaltyBalanceDto redeem(UUID userId, UUID regionId, long points);
}
