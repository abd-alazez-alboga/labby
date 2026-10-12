package com.labby.backend.service;

import com.labby.backend.dto.DriverLedgerEntryDto;
import com.labby.backend.dto.DriverLedgerViewDto;
import com.labby.backend.dto.SettlementRequestDto;
import com.labby.backend.dto.SettlementResponseDto;
import com.labby.backend.dto.WalletCreditRequestDto;
import com.labby.backend.dto.WalletTransactionDto;
import com.labby.backend.dto.WalletTransactionPageDto;
import com.labby.backend.dto.WalletViewDto;
import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.SettlementDirection;
import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.DriverLedgerEntry;
import com.labby.backend.model.Ride;
import com.labby.backend.model.Settlement;
import com.labby.backend.model.WalletTransaction;
import com.labby.backend.repository.DriverBalanceRepository;
import com.labby.backend.repository.DriverLedgerRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.SettlementRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.service.DriverLedgerService.LedgerPosting;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * UC-A-15/27: grants/refunds are reasoned wallet credits (refunds ride-linked, PAY-03) and
 * settlements are immutable records whose single ledger entry moves the balance — all actions
 * audit-logged ({@code wallet.grant}, {@code wallet.refund}, {@code settlement.record}) and the
 * affected user notified through the outbox.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AdminMoneyServiceImpl implements AdminMoneyService {

  private final WalletService walletService;
  private final DriverLedgerService driverLedgerService;
  private final MoneyFloors moneyFloors;
  private final UserRepository userRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final RideRepository rideRepository;
  private final SettlementRepository settlementRepository;
  private final DriverLedgerRepository driverLedgerRepository;
  private final DriverBalanceRepository driverBalanceRepository;
  private final RegionRepository regionRepository;
  private final AuditService auditService;
  private final NotificationService notificationService;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public WalletViewDto wallet(UUID userId) {
    requireUser(userId);
    return walletService.view(userId);
  }

  @Override
  @Transactional(readOnly = true)
  public WalletTransactionPageDto walletTransactions(
      UUID userId, String currency, int page, int size) {
    requireUser(userId);
    return walletService.transactions(userId, currency, page, size);
  }

  @Override
  public WalletTransactionDto credit(
      UUID actorUserId, UUID userId, WalletCreditRequestDto request) {
    requireUser(userId);
    if (request.amount().scale() > 2) {
      throw new InvalidRequestException("The amount can have at most 2 decimals");
    }
    boolean refund = "refund".equals(request.type());
    if (refund && request.rideId() == null) {
      throw new InvalidRequestException("A refund must be linked to a ride (PAY-03)");
    }
    if (!regionRepository.existsByCurrency(request.currency())) {
      throw new InvalidRequestException("currency is not used by any region");
    }
    if (request.rideId() != null) {
      Ride ride =
          rideRepository
              .findById(request.rideId())
              .filter(candidate -> userId.equals(candidate.getRiderUserId()))
              .orElseThrow(() -> new InvalidRequestException("rideId is not a ride of this user"));
      if (refund && !ride.getCurrency().equals(request.currency())) {
        throw new InvalidRequestException("A refund must be in the ride's currency");
      }
    }
    WalletTransaction transaction =
        walletService.credit(
            userId,
            request.currency(),
            request.amount(),
            refund ? WalletTransactionType.REFUND : WalletTransactionType.ADMIN_GRANT,
            request.rideId(),
            actorUserId,
            request.reason());
    notificationService.queue(
        userId,
        refund ? NotificationEvent.WALLET_REFUNDED : NotificationEvent.WALLET_GRANTED,
        Map.of(
            "amount", request.amount().toPlainString(),
            "currency", request.currency()));
    Map<String, Object> after = new LinkedHashMap<>();
    after.put("transactionId", transaction.getId().toString());
    after.put("type", request.type());
    after.put("amount", request.amount());
    after.put("currency", request.currency());
    after.put("rideId", request.rideId());
    after.put("reason", request.reason());
    after.put("balanceAfter", transaction.getBalanceAfter());
    auditService.record(
        actorUserId,
        refund ? "wallet.refund" : "wallet.grant",
        "user",
        userId.toString(),
        null,
        after);
    return WalletServiceImpl.toDto(transaction);
  }

  @Override
  @Transactional(readOnly = true)
  public DriverLedgerViewDto ledger(UUID driverUserId, String currency, int page, int size) {
    requireDriver(driverUserId);
    PageRequest pageRequest = PageRequest.of(page, size);
    Page<DriverLedgerEntry> entries =
        currency == null
            ? driverLedgerRepository.findByDriverUserIdOrderByCreatedAtDescIdDesc(
                driverUserId, pageRequest)
            : driverLedgerRepository.findByDriverUserIdAndCurrencyOrderByCreatedAtDescIdDesc(
                driverUserId, currency, pageRequest);
    return new DriverLedgerViewDto(
        moneyFloors.balanceEntries(driverUserId),
        entries.getContent().stream().map(AdminMoneyServiceImpl::toDto).toList(),
        entries.getNumber(),
        entries.getSize(),
        entries.getTotalElements(),
        entries.getTotalPages());
  }

  @Override
  public SettlementResponseDto settle(
      UUID actorUserId, UUID driverUserId, SettlementRequestDto request) {
    requireDriver(driverUserId);
    if (request.amount().scale() > 2) {
      throw new InvalidRequestException("The amount can have at most 2 decimals");
    }
    if (!settlementCurrencyAllowed(driverUserId, request.currency())) {
      throw new InvalidRequestException(
          "currency must be one the driver holds a balance in or their operating region's");
    }
    boolean payIn = request.direction() == SettlementDirection.PAY_IN;
    Settlement settlement =
        settlementRepository.saveAndFlush(
            Settlement.builder()
                .driverUserId(driverUserId)
                .currency(request.currency())
                .amount(request.amount())
                .direction(request.direction())
                .note(blankToNull(request.note()))
                .recordedBy(actorUserId)
                .createdAt(clock.instant())
                .build());
    DriverLedgerEntry entry =
        driverLedgerService.post(
            new LedgerPosting(
                driverUserId,
                request.currency(),
                payIn ? request.amount() : request.amount().negate(),
                payIn ? DriverLedgerType.SETTLEMENT_PAY_IN : DriverLedgerType.SETTLEMENT_PAY_OUT,
                null,
                settlement.getId(),
                null,
                null,
                null,
                null));
    Map<String, Object> after = new LinkedHashMap<>();
    after.put("driverUserId", driverUserId.toString());
    after.put("direction", request.direction().getValue());
    after.put("amount", request.amount());
    after.put("currency", request.currency());
    after.put("note", settlement.getNote());
    after.put("balanceAfter", entry.getBalanceAfter());
    auditService.record(
        actorUserId, "settlement.record", "settlement", settlement.getId().toString(), null, after);
    BigDecimal floor = moneyFloors.floorFor(driverUserId, request.currency());
    return new SettlementResponseDto(
        settlement.getId(),
        driverUserId,
        settlement.getCurrency(),
        settlement.getAmount(),
        settlement.getDirection(),
        settlement.getNote(),
        settlement.getCreatedAt(),
        entry.getBalanceAfter(),
        moneyFloors.status(entry.getBalanceAfter(), floor));
  }

  private void requireUser(UUID userId) {
    if (!userRepository.existsById(userId)) {
      throw new ResourceNotFoundException("User not found");
    }
  }

  private void requireDriver(UUID driverUserId) {
    if (!roleAssignmentRepository.existsByUserIdAndRole(driverUserId, Role.DRIVER)) {
      throw new ResourceNotFoundException("Not a driver");
    }
  }

  /**
   * W7: a settlement moves money in a currency the driver already holds a balance in, or in their
   * operating region's currency (a first pay-in before any ride posting).
   */
  private boolean settlementCurrencyAllowed(UUID driverUserId, String currency) {
    return driverBalanceRepository.findByDriverUserIdAndCurrency(driverUserId, currency).isPresent()
        || moneyFloors
            .operatingRegion(driverUserId)
            .filter(region -> currency.equals(region.getCurrency()))
            .isPresent();
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }

  private static DriverLedgerEntryDto toDto(DriverLedgerEntry entry) {
    return new DriverLedgerEntryDto(
        entry.getId(),
        entry.getCurrency(),
        entry.getAmount(),
        entry.getType(),
        entry.getRideId(),
        entry.getSettlementId(),
        entry.getRiderDueId(),
        entry.getFareAmount(),
        entry.getCommissionRate(),
        entry.getCommissionAmount(),
        entry.getBalanceAfter(),
        entry.getCreatedAt());
  }
}
