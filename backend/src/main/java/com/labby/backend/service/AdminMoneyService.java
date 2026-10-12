package com.labby.backend.service;

import com.labby.backend.dto.DriverLedgerViewDto;
import com.labby.backend.dto.SettlementRequestDto;
import com.labby.backend.dto.SettlementResponseDto;
import com.labby.backend.dto.WalletCreditRequestDto;
import com.labby.backend.dto.WalletTransactionDto;
import com.labby.backend.dto.WalletTransactionPageDto;
import com.labby.backend.dto.WalletViewDto;
import java.util.UUID;

/** The admin money actions (UC-A-15/27): permission-gated at the controller, audited here. */
public interface AdminMoneyService {

  /**
   * A user's wallet (extends UC-A-13).
   *
   * @param userId the user
   * @return balances and pending dues
   */
  WalletViewDto wallet(UUID userId);

  /**
   * A user's wallet history.
   *
   * @param userId the user
   * @param currency optional currency filter
   * @param page zero-based page
   * @param size page size
   * @return the page
   */
  WalletTransactionPageDto walletTransactions(UUID userId, String currency, int page, int size);

  /**
   * Grants credit or issues a refund (PAY-03): reasoned, audited, user notified; a refund must link
   * a ride of this user.
   *
   * @param actorUserId the acting admin
   * @param userId the credited user
   * @param request the credit
   * @return the ledger entry
   */
  WalletTransactionDto credit(UUID actorUserId, UUID userId, WalletCreditRequestDto request);

  /**
   * A driver's ledger: balances + one newest-first page (UC-A-27 step 1).
   *
   * @param driverUserId the driver
   * @param currency optional currency filter
   * @param page zero-based page
   * @param size page size
   * @return the view
   */
  DriverLedgerViewDto ledger(UUID driverUserId, String currency, int page, int size);

  /**
   * Records a settlement (COM-04): immutable, posts its 1:1 ledger entry, audited; crossing back
   * above the floor notifies the driver.
   *
   * @param actorUserId the acting admin
   * @param driverUserId the driver
   * @param request the settlement
   * @return the settlement with the new balance and floor status
   */
  SettlementResponseDto settle(UUID actorUserId, UUID driverUserId, SettlementRequestDto request);
}
