package com.labby.backend.service;

import com.labby.backend.dto.CarriedDueDto;
import com.labby.backend.dto.TipResponseDto;
import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.RiderDueStatus;
import com.labby.backend.enums.SharedMemberStatus;
import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.DriverLedgerEntry;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RiderDue;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.model.WalletTransaction;
import com.labby.backend.repository.DriverLedgerRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RiderDueRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import com.labby.backend.repository.WalletTransactionRepository;
import com.labby.backend.service.DriverLedgerService.LedgerPosting;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
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
 * order first (M8 audit W2), always AFTER the rider's wallet (the tip's order). A completed shared
 * ride (RIDE-P4, M12) runs the same engine once per completed member — their share, their payment
 * method, their dues — with every entry attributed to the member ({@code shared_ride_member_id}).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class RideMoneyServiceImpl implements RideMoneyService {

  /** PAY-04: tipping closes this long after completion. */
  static final Duration TIP_WINDOW = Duration.ofHours(24);

  /** The members who may tip: riding along (in progress) or done (completed). */
  private static final List<SharedMemberStatus> TIPPING_MEMBERS =
      List.of(SharedMemberStatus.JOINED, SharedMemberStatus.COMPLETED);

  private final WalletService walletService;
  private final DriverLedgerService driverLedgerService;
  private final CommissionService commissionService;
  private final RegionRepository regionRepository;
  private final RideRepository rideRepository;
  private final RiderDueRepository riderDueRepository;
  private final WalletTransactionRepository walletTransactionRepository;
  private final DriverLedgerRepository driverLedgerRepository;
  private final SharedRideMemberRepository sharedRideMemberRepository;
  private final Clock clock;

  @Override
  public void applyAtCompletion(Ride ride, Fare fare) {
    Instant now = clock.instant();
    Payer payer = Payer.of(ride);
    WalletStep step = walletStep(ride, payer, fare.getTotal());
    List<UUID> drivers = new ArrayList<>(cancelledRidesDrivers(step.fromWallet()));
    drivers.add(ride.getDriverUserId());
    driverLedgerService.lockBalances(drivers, ride.getCurrency());
    postFareEntry(ride, payer, fare.getTotal(), step.walletApplied(), now);
    for (RiderDue due : step.fromWallet()) {
      markCollected(due, ride, now);
    }
    if (step.fullyPaid()) {
      ride.setPaymentStatus(PaymentStatus.PAID_WALLET);
      ride.setPaymentConfirmedAt(now);
    }
  }

  @Override
  public void applySharedAtCompletion(Ride ride, List<SharedRideMember> members) {
    Instant now = clock.instant();
    // Every member's wallet steps first, then every driver balance lock, then the postings.
    List<WalletStep> steps = new ArrayList<>();
    List<UUID> drivers = new ArrayList<>();
    for (SharedRideMember member : members) {
      WalletStep step = walletStep(ride, Payer.of(member), member.getShareAmount());
      steps.add(step);
      drivers.addAll(cancelledRidesDrivers(step.fromWallet()));
    }
    drivers.add(ride.getDriverUserId());
    driverLedgerService.lockBalances(drivers, ride.getCurrency());
    for (int i = 0; i < members.size(); i++) {
      SharedRideMember member = members.get(i);
      WalletStep step = steps.get(i);
      postFareEntry(ride, Payer.of(member), member.getShareAmount(), step.walletApplied(), now);
      for (RiderDue due : step.fromWallet()) {
        markCollected(due, ride, now);
      }
      if (step.fullyPaid()) {
        member.setPaymentStatus(PaymentStatus.PAID_WALLET);
        member.setPaymentConfirmedAt(now);
      }
    }
    sharedRideMemberRepository.saveAllAndFlush(members);
    if (members.stream().noneMatch(member -> member.getPaymentStatus() == PaymentStatus.PENDING)) {
      ride.setPaymentConfirmedAt(now);
    }
  }

  /**
   * The wallet half of one payer's completion: the fare (or share) from the wallet first, then
   * every pending due in the ride's currency — taken from the wallet in full when it covers it
   * (wallet method), else earmarked for cash (owner ruling (a), H2/H3).
   */
  private WalletStep walletStep(Ride ride, Payer payer, BigDecimal amount) {
    boolean wallet = payer.method() == PaymentMethod.WALLET;
    BigDecimal walletApplied =
        wallet
            ? walletService.debitUpTo(
                payer.riderUserId(),
                ride.getCurrency(),
                amount,
                WalletTransactionType.FARE_PAYMENT,
                ride.getId())
            : BigDecimal.ZERO;
    List<RiderDue> fromWallet = new ArrayList<>();
    boolean cashCarried = false;
    for (RiderDue due : riderDueRepository.lockPending(payer.riderUserId(), ride.getCurrency())) {
      boolean paid =
          wallet
              && walletService
                  .debitIfCovered(
                      payer.riderUserId(),
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
    return new WalletStep(
        walletApplied, fromWallet, wallet && walletApplied.compareTo(amount) == 0 && !cashCarried);
  }

  /**
   * COM-01: one fare entry per completed ride. The signed amount is what the platform owes the
   * driver for this trip: the wallet-held part minus the commission (cash in the driver's pocket
   * never passes through the ledger). A zero net posts nothing (the ledger forbids zero amounts).
   */
  private void postFareEntry(
      Ride ride, Payer payer, BigDecimal total, BigDecimal walletApplied, Instant now) {
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
            commission,
            payer.memberId()));
  }

  @Override
  public PaymentStatus confirmCash(Ride ride) {
    return confirmCash(ride, Payer.of(ride), riderDueRepository.lockEarmarked(ride.getId()));
  }

  @Override
  public PaymentStatus confirmMemberCash(Ride ride, SharedRideMember member) {
    return confirmCash(
        ride,
        Payer.of(member),
        riderDueRepository.lockEarmarkedOf(ride.getId(), member.getRiderUserId()));
  }

  private PaymentStatus confirmCash(Ride ride, Payer payer, List<RiderDue> earmarked) {
    Instant now = clock.instant();
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
    return payer.method() == PaymentMethod.WALLET
            && walletApplied(ride.getId(), payer.riderUserId()).signum() > 0
        ? PaymentStatus.PAID_MIXED
        : PaymentStatus.PAID_CASH;
  }

  /** The fare part one rider's wallet paid on a ride. */
  private BigDecimal walletApplied(UUID rideId, UUID riderUserId) {
    return walletTransactionRepository.findByRideId(rideId).stream()
        .filter(transaction -> transaction.getType() == WalletTransactionType.FARE_PAYMENT)
        .filter(transaction -> transaction.getUserId().equals(riderUserId))
        .map(transaction -> transaction.getAmount().negate())
        .reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  @Override
  public void releaseCarriedDues(Ride ride) {
    release(riderDueRepository.lockEarmarked(ride.getId()));
  }

  @Override
  public void releaseMemberCarriedDues(Ride ride, SharedRideMember member) {
    release(riderDueRepository.lockEarmarkedOf(ride.getId(), member.getRiderUserId()));
  }

  private void release(List<RiderDue> earmarked) {
    for (RiderDue due : earmarked) {
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

  /**
   * The fee is now fully collected: credit the cancelled ride's driver 100%, commission-free. On a
   * shared ride the fee is the owing MEMBER's (their cancellation or no-show), never the ride's.
   */
  private void creditCancelledRidesDriver(RiderDue due) {
    Ride cancelled = rideRepository.findById(due.getSourceRideId()).orElseThrow();
    if (cancelled.getDriverUserId() == null) {
      return;
    }
    BigDecimal fee = cancelled.getCancellationFee();
    UUID memberId = null;
    if (cancelled.getKind() == RideKind.SHARED) {
      Optional<SharedRideMember> member =
          sharedRideMemberRepository.findFirstByRideIdAndRiderUserIdAndCancellationFeeIsNotNull(
              cancelled.getId(), due.getRiderUserId());
      fee = member.map(SharedRideMember::getCancellationFee).orElse(null);
      memberId = member.map(SharedRideMember::getId).orElse(null);
    }
    if (fee == null) {
      return;
    }
    driverLedgerService.post(
        LedgerPosting.forRide(
                cancelled.getDriverUserId(),
                due.getCurrency(),
                fee,
                DriverLedgerType.CANCELLATION_FEE,
                cancelled.getId(),
                due.getId())
            .forMember(memberId));
  }

  @Override
  public void collectCancellationFee(Ride ride) {
    collectFee(ride, Payer.of(ride), ride.getCancellationFee());
  }

  @Override
  public void collectMemberFee(Ride ride, SharedRideMember member) {
    collectFee(ride, Payer.of(member), member.getCancellationFee());
  }

  private void collectFee(Ride ride, Payer payer, BigDecimal fee) {
    BigDecimal collected = BigDecimal.ZERO;
    if (payer.method() == PaymentMethod.WALLET) {
      collected =
          walletService.debitUpTo(
              payer.riderUserId(),
              ride.getCurrency(),
              fee,
              WalletTransactionType.CANCELLATION_FEE,
              ride.getId());
    }
    BigDecimal remainder = fee.subtract(collected);
    if (remainder.signum() > 0) {
      riderDueRepository.saveAndFlush(
          RiderDue.builder()
              .riderUserId(payer.riderUserId())
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
                  null)
              .forMember(payer.memberId()));
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
            .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    // RIDE-P4: on a shared ride every member who rode tips on their own.
    SharedRideMember member = null;
    if (ride.getKind() == RideKind.SHARED) {
      member =
          sharedRideMemberRepository
              .findFirstByRideIdAndRiderUserIdAndStatusIn(rideId, riderUserId, TIPPING_MEMBERS)
              .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    } else if (!riderUserId.equals(ride.getRiderUserId())) {
      throw new ResourceNotFoundException("Ride not found");
    }
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
    if (walletTransactionRepository.existsByRideIdAndUserIdAndType(
        rideId, riderUserId, WalletTransactionType.TIP)) {
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
                null)
            .forMember(member == null ? null : member.getId()));
    return new TipResponseDto(
        rideId, amount, ride.getCurrency(), debit.getBalanceAfter(), debit.getCreatedAt());
  }

  @Override
  @Transactional(readOnly = true)
  public RideMoney rideMoney(Ride ride, BigDecimal fareTotal) {
    if (ride.getKind() == RideKind.SHARED) {
      // The money lives on the members (MemberView); the ride level reports only the tips.
      BigDecimal tips = sum(walletTransactionRepository.findByRideId(ride.getId()), null, false);
      return tips.signum() > 0 ? new RideMoney(null, null, List.of(), tips) : RideMoney.NONE;
    }
    return money(ride, Payer.of(ride), ride.getPaymentStatus(), fareTotal);
  }

  @Override
  @Transactional(readOnly = true)
  public RideMoney memberMoney(Ride ride, SharedRideMember member) {
    return money(ride, Payer.of(member), member.getPaymentStatus(), member.getShareAmount());
  }

  private RideMoney money(
      Ride ride, Payer payer, PaymentStatus paymentStatus, BigDecimal fareTotal) {
    List<WalletTransaction> transactions = walletTransactionRepository.findByRideId(ride.getId());
    BigDecimal walletApplied = sum(transactions, payer.riderUserId(), true);
    BigDecimal tip = sum(transactions, payer.riderUserId(), false);
    if (paymentStatus == null || fareTotal == null) {
      // M8 re-audit R-W2: an in-progress ride's tip is reported; the split is not (yet).
      return tip.signum() > 0 ? new RideMoney(null, null, List.of(), tip) : RideMoney.NONE;
    }
    List<CarriedDueDto> carriedDues = carriedDues(ride.getId(), payer.riderUserId());
    BigDecimal cashDues =
        carriedDues.stream()
            .filter(due -> CarriedDueDto.METHOD_CASH.equals(due.method()))
            .map(CarriedDueDto::amount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    boolean wallet = payer.method() == PaymentMethod.WALLET;
    BigDecimal cashDue =
        wallet ? fareTotal.subtract(walletApplied).add(cashDues) : fareTotal.add(cashDues);
    return new RideMoney(
        wallet ? walletApplied : null,
        (wallet && cashDue.signum() > 0) || (!wallet && cashDues.signum() > 0) ? cashDue : null,
        carriedDues,
        tip.signum() > 0 ? tip : null);
  }

  /** The fare payments ({@code fares}) or tips of a ride, of one rider (null = every rider). */
  private static BigDecimal sum(
      List<WalletTransaction> transactions, UUID riderUserId, boolean fares) {
    WalletTransactionType type =
        fares ? WalletTransactionType.FARE_PAYMENT : WalletTransactionType.TIP;
    return transactions.stream()
        .filter(transaction -> transaction.getType() == type)
        .filter(transaction -> riderUserId == null || transaction.getUserId().equals(riderUserId))
        .map(transaction -> transaction.getAmount().negate())
        .reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  /**
   * The dues a ride carries (rides-v1 carriedDues): earmarked cash dues, and collected ones — in
   * cash when a {@code due_collection} line of this ride links them, else from the wallet. A
   * released (mark-unpaid) due is no longer this ride's. Only {@code riderUserId}'s (a shared ride
   * carries each member's own).
   */
  private List<CarriedDueDto> carriedDues(UUID rideId, UUID riderUserId) {
    List<RiderDue> dues =
        riderDueRepository.findCarriedBy(rideId).stream()
            .filter(due -> due.getRiderUserId().equals(riderUserId))
            .toList();
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

  /**
   * Who pays on a ride: the ride's rider (member null), or one member of a shared ride.
   *
   * @param riderUserId the paying rider
   * @param method their payment method
   * @param memberId the shared-ride member, or null
   */
  private record Payer(UUID riderUserId, PaymentMethod method, UUID memberId) {

    static Payer of(Ride ride) {
      return new Payer(ride.getRiderUserId(), ride.getPaymentMethod(), null);
    }

    static Payer of(SharedRideMember member) {
      return new Payer(member.getRiderUserId(), member.getPaymentMethod(), member.getId());
    }
  }

  /**
   * The wallet half of one payer's completion.
   *
   * @param walletApplied the wallet part of the fare / share
   * @param fromWallet the dues the wallet paid (credited after the driver locks)
   * @param fullyPaid wallet method, whole amount from the wallet and no cash due earmarked
   */
  private record WalletStep(
      BigDecimal walletApplied, List<RiderDue> fromWallet, boolean fullyPaid) {}
}
