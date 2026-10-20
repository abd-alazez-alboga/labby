package com.labby.backend.service;

import com.labby.backend.dto.WalletTransactionPageDto;
import com.labby.backend.dto.WalletViewDto;
import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.model.WalletTransaction;
import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

/**
 * The per-currency wallet (PAY-01): credits of any typed source, debits never below zero. Every
 * movement is one append-only {@code wallet_transactions} entry written in the SAME transaction as
 * the pessimistically locked balance row, so the balance always equals the ledger sum.
 */
public interface WalletService {

  /**
   * The wallet view: balances (possibly empty) and pending dues (UC-R-17).
   *
   * @param userId the account
   * @return the view
   */
  WalletViewDto view(UUID userId);

  /**
   * One newest-first page of the typed history (UC-R-17).
   *
   * @param userId the account
   * @param currency optional currency filter
   * @param page zero-based page
   * @param size page size
   * @return the page
   */
  WalletTransactionPageDto transactions(UUID userId, String currency, int page, int size);

  /**
   * Credits the wallet (creating the balance row on first credit).
   *
   * @param userId the account
   * @param currency the ISO 4217 currency
   * @param amount the positive amount
   * @param type the credit type (refund, admin grant, or an M13 source)
   * @param rideId the linked ride, or null
   * @param createdBy the acting admin on grants/refunds, else null
   * @param reason the grant/refund reason, else null
   * @return the ledger entry
   */
  WalletTransaction credit(
      UUID userId,
      String currency,
      BigDecimal amount,
      WalletTransactionType type,
      UUID rideId,
      UUID createdBy,
      String reason);

  /**
   * Debits as much of {@code maxAmount} as the balance covers (PAY-02: the wallet pays what it
   * can). No entry is written when the balance or {@code maxAmount} is zero (V1 audit C2).
   *
   * @param userId the account
   * @param currency the currency
   * @param maxAmount the positive amount wanted
   * @param type the debit type
   * @param rideId the linked ride
   * @return the amount actually debited (0 .. maxAmount)
   */
  BigDecimal debitUpTo(
      UUID userId, String currency, BigDecimal maxAmount, WalletTransactionType type, UUID rideId);

  /**
   * Debits exactly {@code amount} (tips, PAY-04).
   *
   * @param userId the account
   * @param currency the currency
   * @param amount the positive amount
   * @param type the debit type
   * @param rideId the linked ride
   * @return the ledger entry
   * @throws com.labby.backend.exception.ConflictException when the balance is insufficient
   */
  WalletTransaction debit(
      UUID userId, String currency, BigDecimal amount, WalletTransactionType type, UUID rideId);

  /**
   * Debits exactly {@code amount} when the LOCKED balance covers it, else nothing — the
   * full-or-nothing wallet collection of a carried due (owner ruling (a)). Unlike {@link #debit} a
   * shortfall is not an error, so the caller's transaction stays committable.
   *
   * @param userId the account
   * @param currency the currency
   * @param amount the positive amount
   * @param type the debit type
   * @param rideId the linked ride
   * @return the ledger entry, or empty when the balance is short
   */
  Optional<WalletTransaction> debitIfCovered(
      UUID userId, String currency, BigDecimal amount, WalletTransactionType type, UUID rideId);

  /**
   * The balance in a currency (0 when no wallet row exists).
   *
   * @param userId the account
   * @param currency the currency
   * @return the balance
   */
  BigDecimal balance(UUID userId, String currency);
}
