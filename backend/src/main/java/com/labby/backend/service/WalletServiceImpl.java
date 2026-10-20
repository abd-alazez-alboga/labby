package com.labby.backend.service;

import com.labby.backend.dto.RiderDueDto;
import com.labby.backend.dto.WalletBalanceDto;
import com.labby.backend.dto.WalletTransactionDto;
import com.labby.backend.dto.WalletTransactionPageDto;
import com.labby.backend.dto.WalletViewDto;
import com.labby.backend.enums.RiderDueStatus;
import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.model.WalletBalance;
import com.labby.backend.model.WalletTransaction;
import com.labby.backend.repository.RiderDueRepository;
import com.labby.backend.repository.WalletBalanceRepository;
import com.labby.backend.repository.WalletTransactionRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Wallet writes lock the (user, currency) balance row FOR UPDATE, then append the ledger entry and
 * update the cached balance in the same transaction — the balance always equals the ledger sum and
 * can never go negative (PAY-01; the V12 CHECKs are the backstop).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class WalletServiceImpl implements WalletService {

  private final WalletBalanceRepository walletBalanceRepository;
  private final WalletTransactionRepository walletTransactionRepository;
  private final RiderDueRepository riderDueRepository;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public WalletViewDto view(UUID userId) {
    return new WalletViewDto(
        walletBalanceRepository.findByUserIdOrderByCurrencyAsc(userId).stream()
            .map(balance -> new WalletBalanceDto(balance.getCurrency(), balance.getBalance()))
            .toList(),
        riderDueRepository
            .findByRiderUserIdAndStatusOrderByCreatedAtAsc(userId, RiderDueStatus.PENDING)
            .stream()
            .map(
                due ->
                    new RiderDueDto(
                        due.getId(),
                        due.getCurrency(),
                        due.getAmount(),
                        due.getType(),
                        due.getSourceRideId(),
                        due.getStatus(),
                        due.getCollectedRideId(),
                        due.getCreatedAt(),
                        due.getCollectedAt()))
            .toList());
  }

  @Override
  @Transactional(readOnly = true)
  public WalletTransactionPageDto transactions(UUID userId, String currency, int page, int size) {
    PageRequest request = PageRequest.of(page, size);
    Page<WalletTransaction> transactions =
        currency == null
            ? walletTransactionRepository.findByUserIdOrderByCreatedAtDescIdDesc(userId, request)
            : walletTransactionRepository.findByUserIdAndCurrencyOrderByCreatedAtDescIdDesc(
                userId, currency, request);
    return new WalletTransactionPageDto(
        transactions.getContent().stream().map(WalletServiceImpl::toDto).toList(),
        transactions.getNumber(),
        transactions.getSize(),
        transactions.getTotalElements(),
        transactions.getTotalPages());
  }

  @Override
  public WalletTransaction credit(
      UUID userId,
      String currency,
      BigDecimal amount,
      WalletTransactionType type,
      UUID rideId,
      UUID createdBy,
      String reason) {
    WalletBalance balance = lockOrCreate(userId, currency);
    balance.setBalance(balance.getBalance().add(amount));
    walletBalanceRepository.saveAndFlush(balance);
    return append(userId, currency, amount, type, rideId, createdBy, reason, balance.getBalance());
  }

  @Override
  public BigDecimal debitUpTo(
      UUID userId, String currency, BigDecimal maxAmount, WalletTransactionType type, UUID rideId) {
    // V1 audit C2: nothing to debit (a promo covering the whole fare) writes nothing — the ledger
    // forbids zero-amount rows.
    if (maxAmount == null || maxAmount.signum() <= 0) {
      return BigDecimal.ZERO;
    }
    WalletBalance balance = walletBalanceRepository.findForUpdate(userId, currency).orElse(null);
    if (balance == null || balance.getBalance().signum() <= 0) {
      return BigDecimal.ZERO;
    }
    BigDecimal debited = balance.getBalance().min(maxAmount);
    applyDebit(balance, debited, type, rideId);
    return debited;
  }

  @Override
  public WalletTransaction debit(
      UUID userId, String currency, BigDecimal amount, WalletTransactionType type, UUID rideId) {
    WalletBalance balance = walletBalanceRepository.findForUpdate(userId, currency).orElse(null);
    if (balance == null || balance.getBalance().compareTo(amount) < 0) {
      throw (ConflictException)
          new ConflictException("Your wallet balance is not enough")
              .withCode("insufficient_balance");
    }
    return applyDebit(balance, amount, type, rideId);
  }

  @Override
  public Optional<WalletTransaction> debitIfCovered(
      UUID userId, String currency, BigDecimal amount, WalletTransactionType type, UUID rideId) {
    WalletBalance balance = walletBalanceRepository.findForUpdate(userId, currency).orElse(null);
    if (balance == null || balance.getBalance().compareTo(amount) < 0) {
      return Optional.empty();
    }
    return Optional.of(applyDebit(balance, amount, type, rideId));
  }

  @Override
  @Transactional(readOnly = true)
  public BigDecimal balance(UUID userId, String currency) {
    return walletBalanceRepository
        .findById(new WalletBalance.Key(userId, currency))
        .map(WalletBalance::getBalance)
        .orElse(BigDecimal.ZERO);
  }

  private WalletTransaction applyDebit(
      WalletBalance balance, BigDecimal amount, WalletTransactionType type, UUID rideId) {
    balance.setBalance(balance.getBalance().subtract(amount));
    walletBalanceRepository.saveAndFlush(balance);
    return append(
        balance.getUserId(),
        balance.getCurrency(),
        amount.negate(),
        type,
        rideId,
        null,
        null,
        balance.getBalance());
  }

  private WalletTransaction append(
      UUID userId,
      String currency,
      BigDecimal amount,
      WalletTransactionType type,
      UUID rideId,
      UUID createdBy,
      String reason,
      BigDecimal balanceAfter) {
    return walletTransactionRepository.saveAndFlush(
        WalletTransaction.builder()
            .userId(userId)
            .currency(currency)
            .amount(amount)
            .type(type)
            .rideId(rideId)
            .createdBy(createdBy)
            .reason(reason)
            .balanceAfter(balanceAfter)
            .createdAt(clock.instant())
            .build());
  }

  /** Insert-if-absent, then lock: a racing first credit never hits a primary-key clash (W3). */
  private WalletBalance lockOrCreate(UUID userId, String currency) {
    walletBalanceRepository.insertIfAbsent(userId, currency);
    return walletBalanceRepository.findForUpdate(userId, currency).orElseThrow();
  }

  static WalletTransactionDto toDto(WalletTransaction transaction) {
    return new WalletTransactionDto(
        transaction.getId(),
        transaction.getCurrency(),
        transaction.getAmount(),
        transaction.getType(),
        transaction.getRideId(),
        transaction.getReason(),
        transaction.getBalanceAfter(),
        transaction.getCreatedAt());
  }
}
