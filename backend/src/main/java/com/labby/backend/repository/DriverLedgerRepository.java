package com.labby.backend.repository;

import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.model.DriverLedgerEntry;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** The append-only driver ledger (COM-01): INSERT only, never update or delete. */
public interface DriverLedgerRepository extends JpaRepository<DriverLedgerEntry, UUID> {

  Page<DriverLedgerEntry> findByDriverUserIdOrderByCreatedAtDescIdDesc(
      UUID driverUserId, Pageable pageable);

  Page<DriverLedgerEntry> findByDriverUserIdAndCurrencyOrderByCreatedAtDescIdDesc(
      UUID driverUserId, String currency, Pageable pageable);

  /** The per-trip anchors of the earnings page (fare postings and collected fee credits). */
  Page<DriverLedgerEntry> findByDriverUserIdAndTypeInOrderByCreatedAtDescIdDesc(
      UUID driverUserId, Collection<DriverLedgerType> types, Pageable pageable);

  List<DriverLedgerEntry> findByDriverUserIdAndTypeAndRideIdIn(
      UUID driverUserId, DriverLedgerType type, Collection<UUID> rideIds);

  List<DriverLedgerEntry> findByRideId(UUID rideId);

  boolean existsByRideIdAndType(UUID rideId, DriverLedgerType type);

  /** Entries of the given types inside a period, for the earnings summary (UC-D-15). */
  List<DriverLedgerEntry>
      findByDriverUserIdAndCurrencyAndTypeInAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
          UUID driverUserId,
          String currency,
          Collection<DriverLedgerType> types,
          Instant from,
          Instant to);

  /** The ledger sum per driver x currency — the balance invariant (M8 milestone AC). */
  @Query(
      "SELECT COALESCE(SUM(e.amount), 0) FROM DriverLedgerEntry e"
          + " WHERE e.driverUserId = :driverUserId AND e.currency = :currency")
  BigDecimal sumAmounts(
      @Param("driverUserId") UUID driverUserId, @Param("currency") String currency);

  /**
   * DRV-06 earnings in the window {@code [from, to]}: the driver's share of each fare posting (fare
   * minus commission, COM-01) by posting moment, per currency.
   */
  @Query(
      value =
          """
          SELECT currency AS currency, SUM(fare_amount - commission_amount) AS amount
          FROM driver_ledger
          WHERE driver_user_id = :driverUserId
            AND type IN ('ride_earning', 'commission_due')
            AND created_at BETWEEN :from AND :to
          GROUP BY currency
          ORDER BY currency
          """,
      nativeQuery = true)
  List<CurrencyAmount> fareEarnings(
      @Param("driverUserId") UUID driverUserId,
      @Param("from") Instant from,
      @Param("to") Instant to);

  /** An amount in one currency. */
  interface CurrencyAmount {
    String getCurrency();

    BigDecimal getAmount();
  }
}
