package com.labby.backend.service;

import com.labby.backend.dto.CarriedDueDto;
import com.labby.backend.dto.TipResponseDto;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Ride;
import com.labby.backend.model.SharedRideMember;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The money consequences of the ride lifecycle (money-v1.yaml): payment application and dues
 * collection at completion (PAY-02), cancellation-fee collection at cancellation (RIDE-07), tips
 * (PAY-04) and the wallet/cash split the views show.
 */
public interface RideMoneyService {

  /**
   * Applies the money of a just-completed ride, in the completion transaction: wallet application
   * for wallet-method rides, the COM-01 fare posting at the driver's weekly rate, and ALL the
   * rider's pending dues in the ride's currency carried on top — taken from the wallet when it
   * covers one (wallet method), else EARMARKED for cash (collected on cash-confirm, M8 audit H3).
   * {@code paid_wallet} (auto-confirmed) only when the wallet paid the whole fare and no cash due
   * is earmarked; the caller saves the mutated ride.
   *
   * @param ride the completed ride (locked; {@code completedAt} and {@code PENDING} already set)
   * @param fare the stored final fare
   */
  void applyAtCompletion(Ride ride, Fare fare);

  /**
   * {@link #applyAtCompletion} for a completed shared ride (RIDE-P4): run once per completed member
   * on THEIR share, payment method and dues; every ledger entry carries the member. A member the
   * wallet fully paid becomes {@code paid_wallet}; the members are saved, and the ride's {@code
   * paymentConfirmedAt} is set when no member is left {@code pending} (the caller saves the ride).
   *
   * @param ride the completed ride (locked, {@code split})
   * @param members its {@code completed} members, shares set, {@code pending}
   */
  /**
   * Shared-ride money at completion. {@code appliedDiscounts} maps a member's user id to the promo
   * discount actually applied to their share (M13 review W8: the reservation row may still carry
   * the booking estimate when the applied discount rounded to zero).
   */
  void applySharedAtCompletion(
      Ride ride, List<SharedRideMember> members, Map<UUID, BigDecimal> appliedDiscounts);

  /**
   * Resolves the cash confirmation of a {@code pending} ride (PAY-02): collects the dues it carries
   * in cash — the collecting driver's {@code due_collection} debit, the cancelled ride's driver's
   * {@code cancellation_fee} credit — and returns the confirmed status: {@code paid_mixed} when the
   * wallet paid part of the fare, else {@code paid_cash}.
   *
   * @param ride the locked completed ride
   * @return the status to store
   */
  PaymentStatus confirmCash(Ride ride);

  /**
   * {@link #confirmCash} for one member of a completed shared ride: collects THEIR carried cash
   * dues and returns their confirmed status.
   *
   * @param ride the locked completed ride
   * @param member the {@code pending} member
   * @return the status to store on the member
   */
  PaymentStatus confirmMemberCash(Ride ride, SharedRideMember member);

  /**
   * Releases the cash dues a ride marked unpaid carried (M8 audit H3): no money moved, so the dues
   * are simply pending again and the rider's next same-currency ride carries them.
   *
   * @param ride the locked completed ride
   */
  void releaseCarriedDues(Ride ride);

  /**
   * {@link #releaseCarriedDues} for one member of a completed shared ride.
   *
   * @param ride the locked completed ride
   * @param member the member marked unpaid
   */
  void releaseMemberCarriedDues(Ride ride, SharedRideMember member);

  /**
   * Collects a just-recorded cancellation fee (RIDE-07, owner rulings 2026-10-11): wallet-method
   * rides debit the wallet up to the fee; any shortfall — and the whole fee on cash-method rides —
   * becomes a pending rider due. A fully collected fee credits the ride's driver immediately,
   * commission-free.
   *
   * @param ride the cancelled ride (locked, saved, {@code cancellationFee} set)
   */
  void collectCancellationFee(Ride ride);

  /**
   * {@link #collectCancellationFee} for one member of a shared ride (RIDE-P5 cancellation after the
   * grace, or a no-show): by THEIR payment method, the due in their name, the driver credit
   * attributed to the member.
   *
   * @param ride the shared ride (locked)
   * @param member the member, saved with {@code cancellationFee} set
   */
  void collectMemberFee(Ride ride, SharedRideMember member);

  /**
   * Tips the ride's driver from the rider's wallet (PAY-04): rider of the ride only, from {@code
   * in_progress} until 24 h after {@code completedAt}, once per ride, in the ride's currency, 100%
   * to the driver commission-free. On a shared ride every member who rode tips once on their own.
   *
   * @param riderUserId the caller
   * @param rideId the ride
   * @param amount the tip
   * @return the applied tip
   */
  TipResponseDto tip(UUID riderUserId, UUID rideId, BigDecimal amount);

  /**
   * The wallet/cash split and carried dues of a completed ride, and the tip of any ride, for its
   * views (rides-v1 walletApplied / cashDue / carriedDues / tip).
   *
   * @param ride the ride
   * @param fareTotal the stored fare total, or null when none exists
   * @return the split (all-null before completion, except a tip given while in progress); on a
   *     shared ride only the sum of the members' tips (the rest is per member)
   */
  RideMoney rideMoney(Ride ride, BigDecimal fareTotal);

  /**
   * The money view of one member of a shared ride: their share's wallet/cash split, their carried
   * dues and their tip.
   *
   * @param ride the shared ride
   * @param member the member
   * @return the split (all-null until the member is {@code completed}, except a tip)
   */
  RideMoney memberMoney(Ride ride, SharedRideMember member);

  /**
   * The money view of one ride.
   *
   * @param walletApplied the wallet part of the fare (wallet-method rides)
   * @param cashDue the cash part of the fare plus the cash carried dues, when a wallet ride owes
   *     cash or a cash ride carries a cash due
   * @param carriedDues the dues this ride carries (never null)
   * @param tip the tip, when one was given
   */
  record RideMoney(
      BigDecimal walletApplied,
      BigDecimal cashDue,
      List<CarriedDueDto> carriedDues,
      BigDecimal tip) {

    /** The empty split (not completed / nothing posted). */
    public static final RideMoney NONE = new RideMoney(null, null, List.of(), null);
  }
}
