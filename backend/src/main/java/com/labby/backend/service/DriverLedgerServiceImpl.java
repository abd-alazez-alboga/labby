package com.labby.backend.service;

import com.labby.backend.model.DriverBalance;
import com.labby.backend.model.DriverLedgerEntry;
import com.labby.backend.repository.DriverBalanceRepository;
import com.labby.backend.repository.DriverLedgerRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.Collection;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ledger postings lock the (driver, currency) balance row FOR UPDATE, append the entry and update
 * the cached balance in the same transaction — the balance always equals the ledger sum (M8
 * milestone AC). Unlike wallets, driver balances may go negative (cash commission debt).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverLedgerServiceImpl implements DriverLedgerService {

  private final DriverBalanceRepository driverBalanceRepository;
  private final DriverLedgerRepository driverLedgerRepository;
  private final MoneyFloors moneyFloors;
  private final Clock clock;

  @Override
  public DriverLedgerEntry post(LedgerPosting posting) {
    DriverBalance balance = lockOrCreate(posting.driverUserId(), posting.currency());
    BigDecimal before = balance.getBalance();
    BigDecimal after = before.add(posting.amount());
    balance.setBalance(after);
    driverBalanceRepository.saveAndFlush(balance);
    DriverLedgerEntry entry =
        driverLedgerRepository.saveAndFlush(
            DriverLedgerEntry.builder()
                .driverUserId(posting.driverUserId())
                .currency(posting.currency())
                .amount(posting.amount())
                .type(posting.type())
                .rideId(posting.rideId())
                .settlementId(posting.settlementId())
                .riderDueId(posting.riderDueId())
                .fareAmount(posting.fareAmount())
                .commissionRate(posting.commissionRate())
                .commissionAmount(posting.commissionAmount())
                .sharedRideMemberId(posting.sharedRideMemberId())
                .balanceAfter(after)
                .createdAt(clock.instant())
                .build());
    moneyFloors.notifyTransition(
        posting.driverUserId(), posting.currency(), before, after, posting.type());
    return entry;
  }

  @Override
  public void lockBalances(Collection<UUID> driverUserIds, String currency) {
    driverUserIds.stream()
        .filter(Objects::nonNull)
        .distinct()
        .sorted()
        .forEach(driverUserId -> lockOrCreate(driverUserId, currency));
  }

  /** Insert-if-absent, then lock: a racing first posting never hits a primary-key clash (W3). */
  private DriverBalance lockOrCreate(UUID driverUserId, String currency) {
    driverBalanceRepository.insertIfAbsent(driverUserId, currency);
    return driverBalanceRepository.findForUpdate(driverUserId, currency).orElseThrow();
  }
}
