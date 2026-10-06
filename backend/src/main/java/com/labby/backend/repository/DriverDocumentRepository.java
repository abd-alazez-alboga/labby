package com.labby.backend.repository;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.model.DriverDocument;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Driver documents (DRV-01, DRV-04). */
public interface DriverDocumentRepository extends JpaRepository<DriverDocument, UUID> {

  List<DriverDocument> findByDriverUserIdAndReviewStatusIn(
      UUID driverUserId, Collection<ReviewStatus> statuses);

  /** Every document row of a driver (all slots, all versions), oldest first. */
  List<DriverDocument> findByDriverUserIdOrderByCreatedAtAsc(UUID driverUserId);

  /**
   * Approved CURRENT documents expiring on or before a date (DRV-04 job, UC-A-12 dashboard): the
   * driver's ID/licence plus the ACTIVE vehicle's registration/insurance, of approved drivers.
   *
   * @param approved the document review state that counts as current (approved)
   * @param applicationStatus the driver's application stage (approved)
   * @param latestExpiry inclusive upper bound on {@code expiresOn}
   * @return the documents, earliest expiry first
   */
  @Query(
      """
      SELECT d FROM DriverDocument d
      WHERE d.reviewStatus = :approved
        AND d.expiresOn <= :latestExpiry
        AND EXISTS (
          SELECT 1 FROM DriverProfile p
          WHERE p.userId = d.driverUserId AND p.applicationStatus = :applicationStatus)
        AND (d.vehicleId IS NULL OR EXISTS (
          SELECT 1 FROM Vehicle v WHERE v.id = d.vehicleId AND v.active = true))
      ORDER BY d.expiresOn ASC, d.createdAt ASC
      """)
  List<DriverDocument> findCurrentExpiringOnOrBefore(
      @Param("approved") ReviewStatus approved,
      @Param("applicationStatus") ApplicationStatus applicationStatus,
      @Param("latestExpiry") LocalDate latestExpiry);

  /**
   * The renewal queue (UC-A-12): pending documents of approved drivers that sit beside an approved
   * document of the same slot (driver, type, vehicle), oldest first. Pending documents of a vehicle
   * switch have no approved sibling yet and are therefore not renewals.
   *
   * @param pending the open review state (pending)
   * @param approved the current review state (approved)
   * @param applicationStatus the driver's application stage (approved)
   * @return the renewals, oldest submission first
   */
  @Query(
      """
      SELECT d FROM DriverDocument d
      WHERE d.reviewStatus = :pending
        AND EXISTS (
          SELECT 1 FROM DriverProfile p
          WHERE p.userId = d.driverUserId AND p.applicationStatus = :applicationStatus)
        AND EXISTS (
          SELECT 1 FROM DriverDocument c
          WHERE c.driverUserId = d.driverUserId
            AND c.type = d.type
            AND c.reviewStatus = :approved
            AND ((c.vehicleId IS NULL AND d.vehicleId IS NULL) OR c.vehicleId = d.vehicleId))
      ORDER BY d.createdAt ASC
      """)
  List<DriverDocument> findPendingRenewals(
      @Param("pending") ReviewStatus pending,
      @Param("approved") ReviewStatus approved,
      @Param("applicationStatus") ApplicationStatus applicationStatus);

  /**
   * The document locked FOR UPDATE: concurrent renewal decisions serialize on the renewal row, so
   * the loser re-reads it as decided (409) instead of racing into a half-applied state.
   */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT d FROM DriverDocument d WHERE d.id = :id")
  Optional<DriverDocument> findForUpdate(@Param("id") UUID id);
}
