package com.labby.backend.repository;

import com.labby.backend.enums.RideState;
import com.labby.backend.model.Ride;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Rides (RIDE-01..08). Every state change locks the ride row first ({@link #findForUpdate}). */
public interface RideRepository extends JpaRepository<Ride, UUID>, JpaSpecificationExecutor<Ride> {

  /** States in which a rider has an active ride (UC-R-04 E4). */
  List<RideState> ACTIVE_STATES =
      List.of(
          RideState.REQUESTED,
          RideState.OFFERING,
          RideState.ACCEPTED,
          RideState.DRIVER_ARRIVED,
          RideState.IN_PROGRESS);

  /** States in which a driver is bound to an ongoing trip. */
  List<RideState> ASSIGNED_STATES =
      List.of(RideState.ACCEPTED, RideState.DRIVER_ARRIVED, RideState.IN_PROGRESS);

  /**
   * The ride locked FOR UPDATE: serializes every writer of one ride (accept vs cancel vs timeout),
   * so exactly one of two racing transitions wins.
   */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT r FROM Ride r WHERE r.id = :rideId")
  Optional<Ride> findForUpdate(@Param("rideId") UUID rideId);

  Optional<Ride> findFirstByRiderUserIdAndStateIn(UUID riderUserId, Collection<RideState> states);

  Optional<Ride> findFirstByDriverUserIdAndStateIn(UUID driverUserId, Collection<RideState> states);

  boolean existsByDriverUserIdAndStateIn(UUID driverUserId, Collection<RideState> states);

  /**
   * The driver's ride that still needs them: an assigned trip, or a completed one whose cash is not
   * settled yet (UC-D-09).
   */
  @Query(
      """
      SELECT r FROM Ride r WHERE r.driverUserId = :driverUserId
        AND (r.state IN :assigned
             OR (r.state = com.labby.backend.enums.RideState.COMPLETED
                 AND r.paymentStatus = com.labby.backend.enums.PaymentStatus.PENDING))
      ORDER BY r.requestedAt DESC
      """)
  List<Ride> findDriverCurrent(
      @Param("driverUserId") UUID driverUserId, @Param("assigned") Collection<RideState> assigned);

  Page<Ride> findByRiderUserIdOrderByRequestedAtDesc(UUID riderUserId, Pageable pageable);

  Page<Ride> findByDriverUserIdOrderByRequestedAtDesc(UUID driverUserId, Pageable pageable);

  Optional<Ride> findFirstByRedispatchOfRideId(UUID redispatchOfRideId);

  /**
   * Rides the dispatcher must act on now: new ({@code requested}), or {@code offering} with no open
   * offer (declined), an expired open offer, or past the give-up time.
   */
  @Query(
      value =
          """
          SELECT r.ride_id FROM rides r
          WHERE r.state = 'requested'
             OR (r.state = 'offering' AND (
                   r.requested_at <= :giveUpBefore
                OR NOT EXISTS (SELECT 1 FROM ride_offers o
                               WHERE o.ride_id = r.ride_id AND o.response IS NULL)
                OR EXISTS (SELECT 1 FROM ride_offers o
                           WHERE o.ride_id = r.ride_id AND o.response IS NULL
                             AND o.expires_at <= :now)))
          ORDER BY r.requested_at
          LIMIT :limit
          """,
      nativeQuery = true)
  List<UUID> findDispatchDue(
      @Param("now") Instant now,
      @Param("giveUpBefore") Instant giveUpBefore,
      @Param("limit") int limit);

  /**
   * The ride locked for a background job, skipped when another instance holds it (NFR-P4).
   *
   * @return the ride, or empty when locked elsewhere or gone
   */
  @Query(
      value = "SELECT * FROM rides WHERE ride_id = :rideId FOR UPDATE SKIP LOCKED",
      nativeQuery = true)
  Optional<Ride> lockIfFree(@Param("rideId") UUID rideId);

  /**
   * Eligible dispatch candidates for a ride, nearest first by straight line (RIDE-03, TRK-04):
   * active driver role and account, approved and online, a FRESH stream, the active vehicle
   * assigned the service type, no open offer, no assigned ride, never offered this ride, not the
   * rider, not excluded, and within {@code maxDistanceM} when set ({@code nearby_only}).
   */
  @Query(
      value =
          """
          SELECT p.user_id AS driverUserId, v.vehicle_id AS vehicleId,
                 ST_Y(l.position) AS lat, ST_X(l.position) AS lng,
                 ST_Distance(l.position::geography, r.pickup::geography) AS distanceMeters
          FROM rides r
          JOIN driver_profiles p ON p.is_online AND p.application_status = 'approved'
          JOIN users u ON u.user_id = p.user_id AND u.state = 'active'
          JOIN role_assignments ra
            ON ra.user_id = p.user_id AND ra.role = 'driver' AND ra.state = 'active'
          JOIN vehicles v ON v.driver_user_id = p.user_id AND v.is_active
          JOIN vehicle_service_types vst
            ON vst.vehicle_id = v.vehicle_id AND vst.service_type_id = r.service_type_id
          JOIN driver_locations l ON l.user_id = p.user_id AND l.received_at >= :freshAfter
          WHERE r.ride_id = :rideId
            AND p.user_id <> r.rider_user_id
            AND NOT (p.user_id = ANY(CAST(:excluded AS uuid[])))
            AND NOT EXISTS (SELECT 1 FROM ride_offers o
                            WHERE o.driver_user_id = p.user_id AND o.response IS NULL)
            AND NOT EXISTS (SELECT 1 FROM ride_offers o
                            WHERE o.ride_id = r.ride_id AND o.driver_user_id = p.user_id)
            AND NOT EXISTS (SELECT 1 FROM rides a WHERE a.driver_user_id = p.user_id
                            AND a.state IN ('accepted', 'driver_arrived', 'in_progress'))
            AND (CAST(:maxDistanceM AS double precision) IS NULL
                 OR ST_DWithin(l.position::geography, r.pickup::geography,
                               CAST(:maxDistanceM AS double precision)))
          ORDER BY distanceMeters
          LIMIT :limit
          """,
      nativeQuery = true)
  List<DispatchCandidate> findDispatchCandidates(
      @Param("rideId") UUID rideId,
      @Param("freshAfter") Instant freshAfter,
      @Param("excluded") String excluded,
      @Param("maxDistanceM") Double maxDistanceM,
      @Param("limit") int limit);

  /**
   * Straight-line distance from the driver's latest position to the ride's pickup (the 100 m arrive
   * geofence, RIDE-04), when that position arrived at or after {@code freshAfter}.
   *
   * @return meters, or empty when there is no fresh position
   */
  @Query(
      value =
          """
          SELECT ST_Distance(l.position::geography, r.pickup::geography)
          FROM rides r JOIN driver_locations l ON l.user_id = r.driver_user_id
          WHERE r.ride_id = :rideId AND l.received_at >= :freshAfter
          """,
      nativeQuery = true)
  Optional<Double> driverDistanceToPickup(
      @Param("rideId") UUID rideId, @Param("freshAfter") Instant freshAfter);

  List<Ride> findByStateIn(Collection<RideState> states);

  /** A dispatch candidate row. */
  interface DispatchCandidate {
    UUID getDriverUserId();

    UUID getVehicleId();

    double getLat();

    double getLng();

    double getDistanceMeters();
  }
}
