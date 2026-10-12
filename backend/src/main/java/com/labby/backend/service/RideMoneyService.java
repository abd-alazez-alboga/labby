package com.labby.backend.service;

import com.labby.backend.dto.CarriedDueDto;
import com.labby.backend.dto.TipResponseDto;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Ride;
import java.math.BigDecimal;
import java.util.List;
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
   * Releases the cash dues a ride marked unpaid carried (M8 audit H3): no money moved, so the dues
   * are simply pending again and the rider's next same-currency ride carries them.
   *
   * @param ride the locked completed ride
   */
  void releaseCarriedDues(Ride ride);

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
   * Tips the ride's driver from the rider's wallet (PAY-04): rider of the ride only, from {@code
   * in_progress} until 24 h after {@code completedAt}, once per ride, in the ride's currency, 100%
   * to the driver commission-free.
   *
   * @param riderUserId the caller
   * @param rideId the ride
   * @param amount the tip
   * @return the applied tip
   */
  TipResponseDto tip(UUID riderUserId, UUID rideId, BigDecimal amount);

  /**
   * The wallet/cash split, carried dues and tip of a completed ride for its views (rides-v1
   * walletApplied / cashDue / carriedDues / tip).
   *
   * @param ride the ride
   * @param fareTotal the stored fare total, or null when none exists
   * @return the split (all-null before completion)
   */
  RideMoney rideMoney(Ride ride, BigDecimal fareTotal);

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
