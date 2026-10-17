package com.labby.backend.service;

import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.model.DriverLedgerEntry;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.UUID;

/**
 * The single writer of the driver ledger (COM-01): every posting appends one immutable entry and
 * updates the pessimistically locked per-currency balance in the same transaction, then queues the
 * COM-03 floor notifications the change crossed into.
 */
public interface DriverLedgerService {

  /**
   * Posts one ledger entry.
   *
   * @param posting the entry (signed amount per the type's V12 sign rule)
   * @return the stored entry (with {@code balanceAfter})
   */
  DriverLedgerEntry post(LedgerPosting posting);

  /**
   * Locks (creating when absent) the balance rows of every driver a multi-driver money step will
   * post to, in user-id order, before its first posting (M8 audit W2): two such steps touching the
   * same drivers in opposite roles queue instead of deadlocking. Later {@link #post} calls in the
   * transaction re-enter the held locks.
   *
   * @param driverUserIds the drivers (nulls and duplicates ignored)
   * @param currency the currency of every posting
   */
  void lockBalances(Collection<UUID> driverUserIds, String currency);

  /**
   * One driver ledger posting.
   *
   * @param driverUserId the driver
   * @param currency the currency
   * @param amount the signed amount (credits positive, debits negative)
   * @param type the entry type
   * @param rideId the linked ride, or null
   * @param settlementId the 1:1 settlement, or null
   * @param riderDueId the linked due, or null
   * @param fareAmount the fare total (fare entries only)
   * @param commissionRate the percent applied (fare entries only)
   * @param commissionAmount the commission (fare entries only)
   * @param sharedRideMemberId the shared-ride member the entry is for (RIDE-P4), or null
   */
  record LedgerPosting(
      UUID driverUserId,
      String currency,
      BigDecimal amount,
      DriverLedgerType type,
      UUID rideId,
      UUID settlementId,
      UUID riderDueId,
      BigDecimal fareAmount,
      BigDecimal commissionRate,
      BigDecimal commissionAmount,
      UUID sharedRideMemberId) {

    /**
     * A ride money posting without itemization (tips, fees, due collections).
     *
     * @param driverUserId the driver
     * @param currency the currency
     * @param amount the signed amount
     * @param type the entry type
     * @param rideId the ride
     * @param riderDueId the linked due, or null
     * @return the posting
     */
    public static LedgerPosting forRide(
        UUID driverUserId,
        String currency,
        BigDecimal amount,
        DriverLedgerType type,
        UUID rideId,
        UUID riderDueId) {
      return new LedgerPosting(
          driverUserId, currency, amount, type, rideId, null, riderDueId, null, null, null, null);
    }

    /**
     * The same posting, attributed to one member of a shared ride (V19: one fare / tip /
     * cancellation-fee entry per ride x member).
     *
     * @param memberId the shared-ride member, or null for a one-rider ride
     * @return the posting
     */
    public LedgerPosting forMember(UUID memberId) {
      return new LedgerPosting(
          driverUserId,
          currency,
          amount,
          type,
          rideId,
          settlementId,
          riderDueId,
          fareAmount,
          commissionRate,
          commissionAmount,
          memberId);
    }
  }
}
