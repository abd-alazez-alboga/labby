package com.labby.backend.service;

import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.model.DriverLedgerEntry;
import java.math.BigDecimal;
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
      BigDecimal commissionAmount) {

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
          driverUserId, currency, amount, type, rideId, null, riderDueId, null, null, null);
    }
  }
}
