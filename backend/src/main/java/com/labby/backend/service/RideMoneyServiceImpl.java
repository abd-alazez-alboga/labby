package com.labby.backend.service;

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
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The money engine behind the ride lifecycle (money-v1.yaml). The COM-01 fare posting of a
 * wallet-method ride nets what the platform holds for the driver: {@code walletApplied −
 * commission} — a fully covered fare is the contract's {@code ride_earning} of fare − commission,
 * an empty wallet degrades to the cash ride's {@code commission_due}, and a partial wallet lands in
 * between (the driver pocketed the cash remainder). Dues collected in CASH debit the collecting
 * driver ({@code due_collection}); the cancelled ride's driver is credited the full fee ONCE, when
 * it is fully collected (owner rulings 2026-10-11).
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
    BigDecimal walletApplied = BigDecimal.ZERO;
    if (ride.getPaymentMethod() == PaymentMethod.WALLET) {
      walletApplied =
          walletService.debitUpTo(
              ride.getRiderUserId(),
              ride.getCurrency(),
              total,
              WalletTransactionType.FARE_PAYMENT,
              ride.getId());
      if (walletApplied.compareTo(total) == 0) {
        ride.setPaymentStatus(PaymentStatus.PAID_WALLET);
        ride.setPaymentConfirmedAt(now);
      }
    }
    postFareEntry(ride, total, walletApplied, now);
    collectDues(ride);
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

  /**
   * Collects ALL the rider's pending dues on top of the fare (owner ruling (a)): a due is collected
   * in full or not at all — from the wallet on wallet-method rides when the balance covers it,
   * otherwise in CASH through the completing driver, who then owes it ({@code due_collection}).
   * Either way the cancelled ride's driver gets the full fee now.
   */
  private void collectDues(Ride ride) {
    Instant now = clock.instant();
    for (RiderDue due : riderDueRepository.lockPending(ride.getRiderUserId())) {
      boolean fromWallet =
          ride.getPaymentMethod() == PaymentMethod.WALLET
              && walletService
                      .balance(ride.getRiderUserId(), due.getCurrency())
                      .compareTo(due.getAmount())
                  >= 0;
      if (fromWallet) {
        walletService.debit(
            ride.getRiderUserId(),
            due.getCurrency(),
            due.getAmount(),
            WalletTransactionType.CANCELLATION_FEE,
            due.getSourceRideId());
      } else {
        driverLedgerService.post(
            LedgerPosting.forRide(
                ride.getDriverUserId(),
                due.getCurrency(),
                due.getAmount().negate(),
                DriverLedgerType.DUE_COLLECTION,
                ride.getId(),
                due.getId()));
      }
      due.setStatus(RiderDueStatus.COLLECTED);
      due.setCollectedRideId(ride.getId());
      due.setCollectedAt(now);
      riderDueRepository.saveAndFlush(due);
      creditCancelledRidesDriver(due);
    }
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
    if (ride.getPaymentStatus() == null || fareTotal == null) {
      return RideMoney.NONE;
    }
    BigDecimal walletApplied = BigDecimal.ZERO;
    BigDecimal tip = BigDecimal.ZERO;
    for (WalletTransaction transaction : walletTransactionRepository.findByRideId(ride.getId())) {
      if (transaction.getType() == WalletTransactionType.FARE_PAYMENT) {
        walletApplied = walletApplied.add(transaction.getAmount().negate());
      } else if (transaction.getType() == WalletTransactionType.TIP) {
        tip = tip.add(transaction.getAmount().negate());
      }
    }
    BigDecimal cashDues =
        driverLedgerRepository.findByRideId(ride.getId()).stream()
            .filter(entry -> entry.getType() == DriverLedgerType.DUE_COLLECTION)
            .map(entry -> entry.getAmount().negate())
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    boolean wallet = ride.getPaymentMethod() == PaymentMethod.WALLET;
    BigDecimal cashDue =
        wallet ? fareTotal.subtract(walletApplied).add(cashDues) : fareTotal.add(cashDues);
    return new RideMoney(
        wallet ? walletApplied : null,
        (wallet && cashDue.signum() > 0) || (!wallet && cashDues.signum() > 0) ? cashDue : null,
        tip.signum() > 0 ? tip : null);
  }
}
