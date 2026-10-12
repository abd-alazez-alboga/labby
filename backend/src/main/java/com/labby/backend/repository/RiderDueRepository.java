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
   * The rider's pending dues locked FOR UPDATE, oldest first: two completions racing for the same
   * due collect it exactly once.
   */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query(
      "SELECT d FROM RiderDue d WHERE d.riderUserId = :riderUserId"
          + " AND d.status = com.labby.backend.enums.RiderDueStatus.PENDING"
          + " ORDER BY d.createdAt ASC, d.id ASC")
  List<RiderDue> lockPending(@Param("riderUserId") UUID riderUserId);

  List<RiderDue> findByRiderUserIdAndStatusOrderByCreatedAtAsc(
      UUID riderUserId, RiderDueStatus status);
}
