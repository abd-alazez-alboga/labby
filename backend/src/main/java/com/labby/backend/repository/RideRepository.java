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

  /**
   * The rider's history (M12): their own rides plus the shared rides they rode in as a member (any
   * membership but one left before dispatch), newest first.
   */
  @Query(
      value =
          """
          SELECT r.* FROM rides r
          WHERE r.rider_user_id = :riderUserId
             OR EXISTS (SELECT 1 FROM shared_ride_members m
                        WHERE m.ride_id = r.ride_id AND m.rider_user_id = :riderUserId
                          AND m.status <> 'left')
          ORDER BY r.requested_at DESC
          """,
      countQuery =
          """
          SELECT COUNT(*) FROM rides r
          WHERE r.rider_user_id = :riderUserId
             OR EXISTS (SELECT 1 FROM shared_ride_members m
                        WHERE m.ride_id = r.ride_id AND m.rider_user_id = :riderUserId
                          AND m.status <> 'left')
          """,
      nativeQuery = true)
  Page<Ride> findRiderHistory(@Param("riderUserId") UUID riderUserId, Pageable pageable);

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
   * rider, not excluded, and within {@code maxDistanceM} when set ({@code nearby_only}). M12: the
   * active vehicle has at least {@code minSeats} passenger seats (a shared ride's seats taken,
   * RIDE-P3) and the driver is not a joined member of the ride.
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
          JOIN vehicles v ON v.driver_user_id = p.user_id AND v.is_active AND v.seats >= :minSeats
          JOIN vehicle_service_types vst
            ON vst.vehicle_id = v.vehicle_id AND vst.service_type_id = r.service_type_id
          JOIN driver_locations l ON l.user_id = p.user_id AND l.received_at >= :freshAfter
          WHERE r.ride_id = :rideId
            AND p.user_id <> r.rider_user_id
            AND NOT EXISTS (SELECT 1 FROM shared_ride_members m
                            WHERE m.ride_id = r.ride_id AND m.rider_user_id = p.user_id
                              AND m.status = 'joined')
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
      @Param("minSeats") int minSeats,
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

  /** A region's live rides for the live ops map (ADM-03). */
  List<Ride> findByRegionIdAndStateInOrderByRequestedAtAsc(
      UUID regionId, Collection<RideState> states);

  /** Completed trips per driver in a region inside a window (COM-02 weekly recalc). */
  @Query(
      """
      SELECT r.driverUserId AS driverUserId, COUNT(r) AS trips FROM Ride r
      WHERE r.regionId = :regionId AND r.state = com.labby.backend.enums.RideState.COMPLETED
        AND r.driverUserId IS NOT NULL
        AND r.completedAt >= :from AND r.completedAt < :to
      GROUP BY r.driverUserId
      """)
  List<DriverTripCount> countCompletedTripsByDriver(
      @Param("regionId") UUID regionId, @Param("from") Instant from, @Param("to") Instant to);

  long countByDriverUserIdAndRegionIdAndStateAndCompletedAtGreaterThanEqualAndCompletedAtLessThan(
      UUID driverUserId, UUID regionId, RideState state, Instant from, Instant to);

  /**
   * RATE-01 pending prompts: the caller's completed rides on one side, completed at or after {@code
   * completedSince} (the 7-day window) and not yet rated by that side, newest first.
   *
   * @param userId the caller
   * @param side {@code rider} or {@code driver}
   * @param completedSince now minus the rating window
   * @return the rides
   */
  @Query(
      value =
          """
          SELECT r.* FROM rides r
          WHERE r.state = 'completed' AND r.completed_at >= :completedSince
            AND ((:side = 'rider' AND r.rider_user_id = :userId)
                 OR (:side = 'driver' AND r.driver_user_id = :userId))
            AND NOT EXISTS (SELECT 1 FROM ratings g
                            WHERE g.ride_id = r.ride_id AND g.rater_role = :side)
          ORDER BY r.completed_at DESC
          """,
      nativeQuery = true)
  List<Ride> findRatingPending(
      @Param("userId") UUID userId,
      @Param("side") String side,
      @Param("completedSince") Instant completedSince);

  /**
   * DRV-06 ride metrics of one driver for the window {@code [from, to]} (trust-v1.yaml): rides
   * accepted in the window (by {@code accepted_at}), of them cancelled by the driver — a {@code
   * rider_no_show} cancellation counts in neither the cancellations nor their base (review B-W6) —,
   * of them that reached {@code driver_arrived}, of those the on-time ones (arrived at most the
   * accepted offer's quoted pickup ETA + 5 min after acceptance), and rides completed in the window
   * (by {@code completed_at}). M12 (UC-D-12 E1): a released scheduled-ride claim (by {@code
   * released_at}) counts as one more driver cancellation AND one more base ride, except the
   * system's {@code account_suspended} releases.
   */
  @Query(
      value =
          """
          SELECT
            COUNT(*) FILTER (WHERE r.accepted_at BETWEEN :from AND :to) AS accepted,
            COUNT(*) FILTER (WHERE r.accepted_at BETWEEN :from AND :to
                             AND r.state = 'cancelled_by_driver'
                             AND r.cancellation_reason <> 'rider_no_show')
              + (SELECT COUNT(*) FROM scheduled_claim_releases s
                 WHERE s.driver_user_id = :driverUserId AND s.reason <> 'account_suspended'
                   AND s.released_at BETWEEN :from AND :to) AS cancelledByDriver,
            COUNT(*) FILTER (WHERE r.accepted_at BETWEEN :from AND :to
                             AND (r.state <> 'cancelled_by_driver'
                                  OR r.cancellation_reason <> 'rider_no_show'))
              + (SELECT COUNT(*) FROM scheduled_claim_releases s
                 WHERE s.driver_user_id = :driverUserId AND s.reason <> 'account_suspended'
                   AND s.released_at BETWEEN :from AND :to) AS cancellationBase,
            COUNT(*) FILTER (WHERE r.accepted_at BETWEEN :from AND :to
                             AND r.driver_arrived_at IS NOT NULL) AS arrived,
            COUNT(*) FILTER (WHERE r.accepted_at BETWEEN :from AND :to
                             AND r.driver_arrived_at IS NOT NULL
                             AND r.driver_arrived_at
                                 <= r.accepted_at + (o.pickup_eta_s + 300) * interval '1 second')
              AS onTime,
            COUNT(*) FILTER (WHERE r.state = 'completed'
                             AND r.completed_at BETWEEN :from AND :to) AS trips
          FROM rides r
          LEFT JOIN ride_offers o ON o.ride_id = r.ride_id AND o.driver_user_id = r.driver_user_id
                                 AND o.response = 'accepted'
          WHERE r.driver_user_id = :driverUserId
            AND (r.accepted_at BETWEEN :from AND :to OR r.completed_at BETWEEN :from AND :to)
          """,
      nativeQuery = true)
  DriverRideMetrics driverRideMetrics(
      @Param("driverUserId") UUID driverUserId,
      @Param("from") Instant from,
      @Param("to") Instant to);

  /**
   * Drivers with any offer, accepted ride or released scheduled claim (M12) since the instant — the
   * DRV-07 job's candidates.
   *
   * @param since the oldest moment of interest
   * @return the driver ids
   */
  @Query(
      value =
          """
          SELECT o.driver_user_id FROM ride_offers o WHERE o.offered_at >= :since
          UNION
          SELECT r.driver_user_id FROM rides r
          WHERE r.driver_user_id IS NOT NULL AND r.accepted_at >= :since
          UNION
          SELECT s.driver_user_id FROM scheduled_claim_releases s WHERE s.released_at >= :since
          """,
      nativeQuery = true)
  List<UUID> findDriversActiveSince(@Param("since") Instant since);

  /** A driver's ride counts in a window (DRV-06). */
  interface DriverRideMetrics {
    long getAccepted();

    long getCancelledByDriver();

    /** Accepted rides minus the driver's {@code rider_no_show} cancellations (review B-W6). */
    long getCancellationBase();

    long getArrived();

    long getOnTime();

    long getTrips();
  }

  /** One driver's completed-trip count in a window (COM-02). */
  interface DriverTripCount {
    UUID getDriverUserId();

    long getTrips();
  }

  /** A dispatch candidate row. */
  interface DispatchCandidate {
    UUID getDriverUserId();

    UUID getVehicleId();

    double getLat();

    double getLng();

    double getDistanceMeters();
  }
}
