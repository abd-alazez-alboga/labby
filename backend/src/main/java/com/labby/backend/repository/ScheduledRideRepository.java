package com.labby.backend.repository;

import com.labby.backend.model.ScheduledRide;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Scheduled-ride extensions (RIDE-S1..4). Writers lock the RIDE row first ({@link
 * RideRepository#findForUpdate} / {@link RideRepository#lockIfFree}); the queries here read the
 * per-region timing straight from {@code regions.scheduled_settings} (NULL = SRS defaults).
 */
public interface ScheduledRideRepository extends JpaRepository<ScheduledRide, UUID> {

  /** The region's fallback lead in minutes (default 15). */
  String FALLBACK_LEAD = "COALESCE(CAST(g.scheduled_settings ->> 'fallbackLeadMin' AS int), 15)";

  /** The region's first reminder tier in minutes (default 1440). */
  String FIRST_TIER = "COALESCE(CAST(g.scheduled_settings ->> 'reminderFirstMin' AS int), 1440)";

  /** The region's second reminder tier in minutes (default 60). */
  String SECOND_TIER = "COALESCE(CAST(g.scheduled_settings ->> 'reminderSecondMin' AS int), 60)";

  /**
   * Whether one of the driver's windows covers the pickup, read in the ride region's time zone
   * (DRV-05; surcharge-window semantics: start inclusive, end exclusive, overnight windows belong
   * to the day they start on, start = end = the whole day). Needs aliases s (scheduled_rides) and g
   * (regions), and the :driverUserId parameter.
   */
  String WINDOW_COVERS =
      """
      EXISTS (SELECT 1 FROM availability_windows w
              CROSS JOIN LATERAL (SELECT (s.scheduled_at AT TIME ZONE g.time_zone) AS local) t
              WHERE w.driver_user_id = :driverUserId
                AND ((w.starts_at < w.ends_at
                      AND w.day_of_week = EXTRACT(ISODOW FROM t.local)
                      AND CAST(t.local AS time) >= w.starts_at AND CAST(t.local AS time) < w.ends_at)
                  OR (w.starts_at = w.ends_at
                      AND w.day_of_week = EXTRACT(ISODOW FROM t.local))
                  OR (w.starts_at > w.ends_at
                      AND ((w.day_of_week = EXTRACT(ISODOW FROM t.local)
                            AND CAST(t.local AS time) >= w.starts_at)
                        OR (w.day_of_week = MOD(CAST(EXTRACT(ISODOW FROM t.local) AS int) + 5, 7) + 1
                            AND CAST(t.local AS time) < w.ends_at)))))
      """;

  /**
   * The service types of the driver's ACTIVE approved vehicle (the "same region + service type"
   * rule — service types are region-scoped). Needs alias r (rides) and :driverUserId.
   */
  String SERVICE_TYPE_MATCHES =
      """
      EXISTS (SELECT 1 FROM vehicles v
              JOIN vehicle_service_types vst ON vst.vehicle_id = v.vehicle_id
              WHERE v.driver_user_id = :driverUserId AND v.is_active
                AND v.review_status = 'approved' AND vst.service_type_id = r.service_type_id)
      """;

  /** The claim board's filter (aliases r, s, g; :driverUserId, :now). */
  String BOARD_FROM =
      "FROM scheduled_rides s JOIN rides r ON r.ride_id = s.ride_id"
          + " JOIN regions g ON g.region_id = r.region_id"
          + " WHERE r.state = 'scheduled' AND s.claimed_driver_user_id IS NULL"
          + " AND s.fallback_at IS NULL AND s.converted_at IS NULL"
          + " AND s.scheduled_at > CAST(:now AS timestamptz) + make_interval(mins => "
          + FALLBACK_LEAD
          + ") AND r.rider_user_id <> :driverUserId AND "
          + SERVICE_TYPE_MATCHES
          + " AND "
          + WINDOW_COVERS;

  /**
   * The claim board page (UC-D-11): open, unclaimed, beyond the fallback lead, matching the
   * driver's active vehicle and covered by a window — soonest first.
   */
  @Query(
      value = "SELECT s.ride_id " + BOARD_FROM + " ORDER BY s.scheduled_at, s.ride_id",
      countQuery = "SELECT COUNT(*) " + BOARD_FROM,
      nativeQuery = true)
  Page<UUID> findBoard(
      @Param("driverUserId") UUID driverUserId, @Param("now") Instant now, Pageable pageable);

  /**
   * The board rules for one ride and driver (claim re-check under the ride lock).
   *
   * @return the two board checks
   */
  @Query(
      value =
          "SELECT ("
              + WINDOW_COVERS
              + ") AS windowCovered, ("
              + SERVICE_TYPE_MATCHES
              + ") AS serviceTypeMatches FROM scheduled_rides s JOIN rides r ON r.ride_id ="
              + " s.ride_id JOIN regions g ON g.region_id = r.region_id WHERE s.ride_id = :rideId",
      nativeQuery = true)
  ClaimEligibility eligibility(
      @Param("rideId") UUID rideId, @Param("driverUserId") UUID driverUserId);

  /**
   * Pending rides the clock job must act on now: a reminder tier whose moment passed and is not
   * handled yet (rider, or the claiming driver), or the conversion / fallback moment reached.
   */
  @Query(
      value =
          "SELECT s.ride_id FROM scheduled_rides s JOIN rides r ON r.ride_id = s.ride_id"
              + " JOIN regions g ON g.region_id = r.region_id"
              + " WHERE r.state = 'scheduled' AND s.fallback_at IS NULL AND s.converted_at IS NULL"
              + " AND (s.scheduled_at - make_interval(mins => "
              + FALLBACK_LEAD
              + ") <= :now"
              + " OR (s.rider_reminder_first_at IS NULL AND s.scheduled_at - make_interval(mins => "
              + FIRST_TIER
              + ") <= :now)"
              + " OR (s.rider_reminder_second_at IS NULL AND s.scheduled_at - make_interval(mins"
              + " => "
              + SECOND_TIER
              + ") <= :now)"
              + " OR (s.claimed_driver_user_id IS NOT NULL AND s.driver_reminder_first_at IS NULL"
              + " AND s.scheduled_at - make_interval(mins => "
              + FIRST_TIER
              + ") <= :now)"
              + " OR (s.claimed_driver_user_id IS NOT NULL AND s.driver_reminder_second_at IS NULL"
              + " AND s.scheduled_at - make_interval(mins => "
              + SECOND_TIER
              + ") <= :now))"
              + " ORDER BY s.scheduled_at LIMIT :limit",
      nativeQuery = true)
  List<UUID> findDue(@Param("now") Instant now, @Param("limit") int limit);

  /** The driver's claims not yet executed, soonest first (UC-D-12). */
  @Query(
      value =
          """
          SELECT s.ride_id FROM scheduled_rides s JOIN rides r ON r.ride_id = s.ride_id
          WHERE s.claimed_driver_user_id = :driverUserId AND r.state = 'scheduled'
            AND s.fallback_at IS NULL AND s.converted_at IS NULL
          ORDER BY s.scheduled_at
          """,
      nativeQuery = true)
  List<UUID> findPendingClaims(@Param("driverUserId") UUID driverUserId);

  /** The rider's rides still in {@code scheduled}, soonest first (UC-R-11). */
  @Query(
      value =
          """
          SELECT s.ride_id FROM scheduled_rides s JOIN rides r ON r.ride_id = s.ride_id
          WHERE r.rider_user_id = :riderUserId AND r.state = 'scheduled'
          ORDER BY s.scheduled_at
          """,
      nativeQuery = true)
  List<UUID> findUpcomingOfRider(@Param("riderUserId") UUID riderUserId);

  /** The board checks of one ride for one driver. */
  interface ClaimEligibility {

    /**
     * Whether one of the driver's windows covers the pickup.
     *
     * @return the check
     */
    boolean getWindowCovered();

    /**
     * Whether the driver's active vehicle serves the ride's service type.
     *
     * @return the check
     */
    boolean getServiceTypeMatches();
  }
}
