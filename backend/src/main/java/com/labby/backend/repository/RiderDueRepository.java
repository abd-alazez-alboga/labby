package com.labby.backend.repository;

import com.labby.backend.enums.RiderDueStatus;
import com.labby.backend.model.RiderDue;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Carried rider charges collected on the next completed ride (owner ruling (a)). */
public interface RiderDueRepository extends JpaRepository<RiderDue, UUID> {

  /**
   * The rider's pending dues in one currency that no other ride carries yet, locked FOR UPDATE,
   * oldest first: two completions racing for the same due carry it exactly once. Dues in other
   * currencies stay pending for a ride in their currency (PAY-01 currency isolation, M8 audit H2).
   */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query(
      "SELECT d FROM RiderDue d WHERE d.riderUserId = :riderUserId AND d.currency = :currency"
          + " AND d.status = com.labby.backend.enums.RiderDueStatus.PENDING"
          + " AND d.collectingRideId IS NULL"
          + " ORDER BY d.createdAt ASC, d.id ASC")
  List<RiderDue> lockPending(
      @Param("riderUserId") UUID riderUserId, @Param("currency") String currency);

  /** The pending dues a ride carries in cash (earmarked at its completion), locked FOR UPDATE. */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query(
      "SELECT d FROM RiderDue d WHERE d.collectingRideId = :rideId"
          + " AND d.status = com.labby.backend.enums.RiderDueStatus.PENDING"
          + " ORDER BY d.createdAt ASC, d.id ASC")
  List<RiderDue> lockEarmarked(@Param("rideId") UUID rideId);

  /** The pending dues a ride carries in cash for ONE of its riders (a shared-ride member). */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query(
      "SELECT d FROM RiderDue d WHERE d.collectingRideId = :rideId"
          + " AND d.riderUserId = :riderUserId"
          + " AND d.status = com.labby.backend.enums.RiderDueStatus.PENDING"
          + " ORDER BY d.createdAt ASC, d.id ASC")
  List<RiderDue> lockEarmarkedOf(
      @Param("rideId") UUID rideId, @Param("riderUserId") UUID riderUserId);

  /** Every due a ride carries: earmarked on it, or collected by it (rides-v1 carriedDues). */
  @Query(
      "SELECT d FROM RiderDue d WHERE d.collectedRideId = :rideId OR d.collectingRideId = :rideId"
          + " ORDER BY d.createdAt ASC, d.id ASC")
  List<RiderDue> findCarriedBy(@Param("rideId") UUID rideId);

  List<RiderDue> findByRiderUserIdAndStatusOrderByCreatedAtAsc(
      UUID riderUserId, RiderDueStatus status);
}
