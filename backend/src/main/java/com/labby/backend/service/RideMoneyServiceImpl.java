package com.labby.backend.service;

import com.labby.backend.dto.CarriedDueDto;
import com.labby.backend.dto.TipResponseDto;
import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.RiderDueStatus;
import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.DriverLedgerEntry;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RiderDue;
import com.labby.backend.model.WalletTransaction;
import com.labby.backend.repository.DriverLedgerRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RiderDueRepository;
import com.labby.backend.repository.WalletTransactionRepository;
import com.labby.backend.service.DriverLedgerService.LedgerPosting;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The money engine behind the ride lifecycle (money-v1.yaml). The COM-01 fare posting of a
 * wallet-method ride nets what the platform holds for the driver: {@code walletApplied −
 * commission} — a fully covered fare is the contract's {@code ride_earning} of fare − commission,
 * an empty wallet degrades to the cash ride's {@code commission_due}, and a partial wallet lands in
 * between (the driver pocketed the cash remainder). Dues carried in CASH are only earmarked at
 * completion and collected on the driver's cash-confirm: the collecting driver is debited ({@code
 * due_collection}) and the cancelled ride's driver credited the full fee ONCE (owner rulings
 * 2026-10-11 / 2026-10-12). Steps that post to several drivers lock their balance rows in user-id
 * order first (M8 audit W2), always AFTER the rider's wallet (the tip's order).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class RideMoneyServiceImpl implements RideMoneyService {

  /** PAY-04: tipping closes this long after completion. */
  static final Duration TIP_WINDOW = Duration.ofHours(24);

  private final WalletService walletService;
  private final DriverLedgerService driverLedgerService;
  private final CommissionService commissionService;
  private final RegionRepository regionRepository;
  private final RideRepository rideRepository;
  private final RiderDueRepository riderDueRepository;
  private final WalletTransactionRepository walletTransactionRepository;
  private final DriverLedgerRepository driverLedgerRepository;
  private final Clock clock;

  @Override
  public void applyAtCompletion(Ride ride, Fare fare) {
    Instant now = clock.instant();
    BigDecimal total = fare.getTotal();
    boolean wallet = ride.getPaymentMethod() == PaymentMethod.WALLET;
    // Wallet first (every wallet lock before any driver balance lock).
    BigDecimal walletApplied =
        wallet
            ? walletService.debitUpTo(
                ride.getRiderUserId(),
                ride.getCurrency(),
                total,
                WalletTransactionType.FARE_PAYMENT,
                ride.getId())
            : BigDecimal.ZERO;
    // Owner ruling (a), H2/H3: every pending due in the ride's currency rides along — taken from
    // the wallet in full when it covers it (wallet method), else earmarked for cash.
    List<RiderDue> fromWallet = new ArrayList<>();
    boolean cashCarried = false;
    for (RiderDue due : riderDueRepository.lockPending(ride.getRiderUserId(), ride.getCurrency())) {
      boolean paid =
          wallet
              && walletService
                  .debitIfCovered(
                      ride.getRiderUserId(),
                      due.getCurrency(),
                      due.getAmount(),
                      WalletTransactionType.CANCELLATION_FEE,
                      due.getSourceRideId())
                  .isPresent();
      if (paid) {
        fromWallet.add(due);
      } else {
        due.setCollectingRideId(ride.getId());
        riderDueRepository.saveAndFlush(due);
        cashCarried = true;
      }
    }
    List<UUID> drivers = new ArrayList<>(cancelledRidesDrivers(fromWallet));
    drivers.add(ride.getDriverUserId());
    driverLedgerService.lockBalances(drivers, ride.getCurrency());
    postFareEntry(ride, total, walletApplied, now);
    for (RiderDue due : fromWallet) {
      markCollected(due, ride, now);
    }
    if (wallet && walletApplied.compareTo(total) == 0 && !cashCarried) {
      ride.setPaymentStatus(PaymentStatus.PAID_WALLET);
      ride.setPaymentConfirmedAt(now);
    }
  }

  /**
   * COM-01: one fare entry per completed ride. The signed amount is what the platform owes the
   * driver for this trip: the wallet-held part minus the commission (cash in the driver's pocket
   * never passes through the ledger). A zero net posts nothing (the ledger forbids zero amounts).
   */
  private void postFareEntry(Ride ride, BigDecimal total, BigDecimal walletApplied, Instant now) {
    Region region = regionRepository.findById(ride.getRegionId()).orElseThrow();
    BigDecimal rate = commissionService.ratePercent(ride.getDriverUserId(), region, now);
    BigDecimal commission = CommissionPolicy.commission(total, rate);
    BigDecimal net = walletApplied.subtract(commission);
    if (net.signum() == 0) {
      return;
    }
    driverLedgerService.post(
        new LedgerPosting(
            ride.getDriverUserId(),
            ride.getCurrency(),
            net,
            net.signum() > 0 ? DriverLedgerType.RIDE_EARNING : DriverLedgerType.COMMISSION_DUE,
            ride.getId(),
            null,
            null,
            total,
            rate,
            commission));
  }

  @Override
  public PaymentStatus confirmCash(Ride ride) {
    Instant now = clock.instant();
    List<RiderDue> earmarked = riderDueRepository.lockEarmarked(ride.getId());
    if (!earmarked.isEmpty()) {
      List<UUID> drivers = new ArrayList<>(cancelledRidesDrivers(earmarked));
      drivers.add(ride.getDriverUserId());
      driverLedgerService.lockBalances(drivers, ride.getCurrency());
    }
    for (RiderDue due : earmarked) {
      // The collecting driver pocketed the fee in cash on the platform's behalf.
      driverLedgerService.post(
          LedgerPosting.forRide(
              ride.getDriverUserId(),
              due.getCurrency(),
              due.getAmount().negate(),
              DriverLedgerType.DUE_COLLECTION,
              ride.getId(),
              due.getId()));
      markCollected(due, ride, now);
    }
    return ride.getPaymentMethod() == PaymentMethod.WALLET
            && walletApplied(ride.getId()).signum() > 0
        ? PaymentStatus.PAID_MIXED
        : PaymentStatus.PAID_CASH;
  }

  private BigDecimal walletApplied(UUID rideId) {
    return walletTransactionRepository.findByRideId(rideId).stream()
        .filter(transaction -> transaction.getType() == WalletTransactionType.FARE_PAYMENT)
        .map(transaction -> transaction.getAmount().negate())
        .reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  @Override
  public void releaseCarriedDues(Ride ride) {
    for (RiderDue due : riderDueRepository.lockEarmarked(ride.getId())) {
      due.setCollectingRideId(null);
      riderDueRepository.saveAndFlush(due);
    }
  }

  /** The due is now fully collected by {@code ride}; its cancelled ride's driver gets the fee. */
  private void markCollected(RiderDue due, Ride ride, Instant now) {
    due.setStatus(RiderDueStatus.COLLECTED);
    due.setCollectingRideId(null);
    due.setCollectedRideId(ride.getId());
    due.setCollectedAt(now);
    riderDueRepository.saveAndFlush(due);
    creditCancelledRidesDriver(due);
  }

  /** The drivers of the cancelled rides the dues came from (the fee credits' recipients). */
  private List<UUID> cancelledRidesDrivers(List<RiderDue> dues) {
    return dues.stream()
        .map(due -> rideRepository.findById(due.getSourceRideId()).orElseThrow())
        .map(Ride::getDriverUserId)
        .filter(Objects::nonNull)
        .toList();
  }

  /** The fee is now fully collected: credit the cancelled ride's driver 100%, commission-free. */
  private void creditCancelledRidesDriver(RiderDue due) {
    Ride cancelled = rideRepository.findById(due.getSourceRideId()).orElseThrow();
    if (cancelled.getDriverUserId() == null || cancelled.getCancellationFee() == null) {
      return;
    }
    driverLedgerService.post(
        LedgerPosting.forRide(
            cancelled.getDriverUserId(),
            due.getCurrency(),
            cancelled.getCancellationFee(),
            DriverLedgerType.CANCELLATION_FEE,
            cancelled.getId(),
            due.getId()));
  }

  @Override
  public void collectCancellationFee(Ride ride) {
    BigDecimal fee = ride.getCancellationFee();
    BigDecimal collected = BigDecimal.ZERO;
    if (ride.getPaymentMethod() == PaymentMethod.WALLET) {
      collected =
          walletService.debitUpTo(
              ride.getRiderUserId(),
              ride.getCurrency(),
              fee,
              WalletTransactionType.CANCELLATION_FEE,
              ride.getId());
    }
    BigDecimal remainder = fee.subtract(collected);
    if (remainder.signum() > 0) {
      riderDueRepository.saveAndFlush(
          RiderDue.builder()
              .riderUserId(ride.getRiderUserId())
              .currency(ride.getCurrency())
              .amount(remainder)
              .sourceRideId(ride.getId())
              .createdAt(clock.instant())
              .build());
    } else if (ride.getDriverUserId() != null) {
      driverLedgerService.post(
          LedgerPosting.forRide(
              ride.getDriverUserId(),
              ride.getCurrency(),
              fee,
              DriverLedgerType.CANCELLATION_FEE,
              ride.getId(),
              null));
    }
  }

  @Override
  public TipResponseDto tip(UUID riderUserId, UUID rideId, BigDecimal amount) {
    if (amount.scale() > 2) {
      throw new InvalidRequestException("The tip amount can have at most 2 decimals");
    }
    Ride ride =
        rideRepository
            .findForUpdate(rideId)
            .filter(candidate -> riderUserId.equals(candidate.getRiderUserId()))
            .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    Instant now = clock.instant();
    if (ride.getState() == RideState.COMPLETED) {
      if (now.isAfter(ride.getCompletedAt().plus(TIP_WINDOW))) {
        throw (ConflictException)
            new ConflictException("The tip window for this ride has closed")
                .withCode("tip_window_closed");
      }
    } else if (ride.getState() != RideState.IN_PROGRESS) {
      throw (ConflictException)
          new ConflictException("This ride cannot be tipped").withCode("not_tippable");
    }
    if (walletTransactionRepository.existsByRideIdAndType(rideId, WalletTransactionType.TIP)) {
      throw (ConflictException)
          new ConflictException("This ride already has a tip").withCode("already_tipped");
    }
    WalletTransaction debit;
    try {
      debit =
          walletService.debit(
              riderUserId, ride.getCurrency(), amount, WalletTransactionType.TIP, rideId);
    } catch (ConflictException ex) {
      throw (ConflictException)
          new ConflictException("Your wallet balance is not enough for this tip")
              .withCode("insufficient_balance");
    }
    driverLedgerService.post(
        LedgerPosting.forRide(
            ride.getDriverUserId(),
            ride.getCurrency(),
            amount,
            DriverLedgerType.TIP,
            rideId,
            null));
    return new TipResponseDto(
        rideId, amount, ride.getCurrency(), debit.getBalanceAfter(), debit.getCreatedAt());
  }

  @Override
  @Transactional(readOnly = true)
  public RideMoney rideMoney(Ride ride, BigDecimal fareTotal) {
    BigDecimal walletApplied = BigDecimal.ZERO;
    BigDecimal tip = BigDecimal.ZERO;
    for (WalletTransaction transaction : walletTransactionRepository.findByRideId(ride.getId())) {
      if (transaction.getType() == WalletTransactionType.FARE_PAYMENT) {
        walletApplied = walletApplied.add(transaction.getAmount().negate());
      } else if (transaction.getType() == WalletTransactionType.TIP) {
        tip = tip.add(transaction.getAmount().negate());
      }
    }
    if (ride.getPaymentStatus() == null || fareTotal == null) {
      // M8 re-audit R-W2: an in-progress ride's tip is reported; the split is not (yet).
      return tip.signum() > 0 ? new RideMoney(null, null, List.of(), tip) : RideMoney.NONE;
    }
    List<CarriedDueDto> carriedDues = carriedDues(ride.getId());
    BigDecimal cashDues =
        carriedDues.stream()
            .filter(due -> CarriedDueDto.METHOD_CASH.equals(due.method()))
            .map(CarriedDueDto::amount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    boolean wallet = ride.getPaymentMethod() == PaymentMethod.WALLET;
    BigDecimal cashDue =
        wallet ? fareTotal.subtract(walletApplied).add(cashDues) : fareTotal.add(cashDues);
    return new RideMoney(
        wallet ? walletApplied : null,
        (wallet && cashDue.signum() > 0) || (!wallet && cashDues.signum() > 0) ? cashDue : null,
        carriedDues,
        tip.signum() > 0 ? tip : null);
  }

  /**
   * The dues a ride carries (rides-v1 carriedDues): earmarked cash dues, and collected ones — in
   * cash when a {@code due_collection} line of this ride links them, else from the wallet. A
   * released (mark-unpaid) due is no longer this ride's.
   */
  private List<CarriedDueDto> carriedDues(UUID rideId) {
    List<RiderDue> dues = riderDueRepository.findCarriedBy(rideId);
    if (dues.isEmpty()) {
      return List.of();
    }
    Set<UUID> collectedInCash =
        driverLedgerRepository.findByRideId(rideId).stream()
            .filter(entry -> entry.getType() == DriverLedgerType.DUE_COLLECTION)
            .map(DriverLedgerEntry::getRiderDueId)
            .collect(Collectors.toSet());
    return dues.stream()
        .map(
            due -> {
              boolean earmarked = due.getStatus() == RiderDueStatus.PENDING;
              boolean cash = earmarked || collectedInCash.contains(due.getId());
              return new CarriedDueDto(
                  due.getId(),
                  due.getSourceRideId(),
                  due.getAmount(),
                  due.getCurrency(),
                  cash ? CarriedDueDto.METHOD_CASH : CarriedDueDto.METHOD_WALLET,
                  earmarked ? CarriedDueDto.STATUS_EARMARKED : CarriedDueDto.STATUS_COLLECTED);
            })
        .toList();
  }
}
