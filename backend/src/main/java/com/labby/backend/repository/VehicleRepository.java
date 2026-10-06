package com.labby.backend.repository;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.model.Vehicle;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Drivers' vehicles (DRV-03). */
public interface VehicleRepository extends JpaRepository<Vehicle, UUID> {

  /** The driver's single active vehicle, if any. */
  Optional<Vehicle> findByDriverUserIdAndActiveTrue(UUID driverUserId);

  List<Vehicle> findByDriverUserIdOrderByCreatedAtDesc(UUID driverUserId);

  /** The driver's most recently submitted vehicle (the application's, before approval). */
  Optional<Vehicle> findFirstByDriverUserIdOrderByCreatedAtDesc(UUID driverUserId);

  /** Whether the driver has a vehicle in review (at most one — V6 partial unique index). */
  boolean existsByDriverUserIdAndReviewStatusIn(
      UUID driverUserId, Collection<ReviewStatus> statuses);

  /** Duplicate-plate check (UC-D-01 E3 / UC-A-10 E1): the plate on ANOTHER driver's active car. */
  boolean existsByPlateAndActiveTrueAndDriverUserIdNot(String plate, UUID driverUserId);

  /**
   * The vehicle-switch queue (UC-A-11): vehicles in the given review state whose driver's
   * application has the given stage (approved drivers' switch candidates), oldest first.
   *
   * @param reviewStatus the vehicle review state (pending)
   * @param applicationStatus the driver's application stage (approved)
   * @return the vehicles, oldest submission first
   */
  @Query(
      """
      SELECT v FROM Vehicle v
      WHERE v.reviewStatus = :reviewStatus
        AND EXISTS (
          SELECT 1 FROM DriverProfile p
          WHERE p.userId = v.driverUserId AND p.applicationStatus = :applicationStatus)
      ORDER BY v.createdAt ASC
      """)
  List<Vehicle> findSwitchCandidates(
      @Param("reviewStatus") ReviewStatus reviewStatus,
      @Param("applicationStatus") ApplicationStatus applicationStatus);
}
