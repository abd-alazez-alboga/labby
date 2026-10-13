package com.labby.backend.repository;

import com.labby.backend.model.DriverLocation;
import com.labby.backend.repository.projection.LiveOpsDriverRow;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Drivers' latest positions (TRK-01). */
public interface DriverLocationRepository extends JpaRepository<DriverLocation, UUID> {

  /**
   * Stores a sample as the driver's current position in one statement: inserts the first row, or
   * overwrites it only when the sample is newer than the stored fix (out-of-order samples are
   * ignored).
   *
   * @return 1 when stored, 0 when ignored as older
   */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO driver_locations
            (user_id, position, heading_deg, speed_mps, accuracy_m, recorded_at, received_at)
          VALUES (:userId, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                  CAST(:headingDeg AS real), CAST(:speedMps AS real), CAST(:accuracyM AS real),
                  :recordedAt, :receivedAt)
          ON CONFLICT (user_id) DO UPDATE
            SET position = EXCLUDED.position, heading_deg = EXCLUDED.heading_deg,
                speed_mps = EXCLUDED.speed_mps, accuracy_m = EXCLUDED.accuracy_m,
                recorded_at = EXCLUDED.recorded_at, received_at = EXCLUDED.received_at
            WHERE driver_locations.recorded_at < EXCLUDED.recorded_at
          """,
      nativeQuery = true)
  int upsertIfNewer(
      @Param("userId") UUID userId,
      @Param("lat") double lat,
      @Param("lng") double lng,
      @Param("headingDeg") Double headingDeg,
      @Param("speedMps") Double speedMps,
      @Param("accuracyM") Double accuracyM,
      @Param("recordedAt") Instant recordedAt,
      @Param("receivedAt") Instant receivedAt);

  /**
   * Whether an ONLINE driver's latest sample arrived at or after the cutoff (TRK-04).
   *
   * @param userId the driver
   * @param cutoff now minus the stale window
   * @return true when the stream is healthy
   */
  @Query(
      """
      SELECT COUNT(l) > 0 FROM DriverLocation l, DriverProfile p
      WHERE l.userId = :userId AND p.userId = l.userId AND p.online = true
        AND l.receivedAt >= :cutoff
      """)
  boolean isStreaming(@Param("userId") UUID userId, @Param("cutoff") Instant cutoff);

  /**
   * Online drivers whose latest sample arrived at or after the cutoff — the M7 dispatcher's
   * offerable-by-stream set (TRK-04).
   *
   * @param cutoff now minus the stale window
   * @return the driver account ids
   */
  @Query(
      """
      SELECT l.userId FROM DriverLocation l, DriverProfile p
      WHERE p.userId = l.userId AND p.online = true AND l.receivedAt >= :cutoff
      """)
  List<UUID> findStreamingDriverIds(@Param("cutoff") Instant cutoff);

  /**
   * Online drivers with a FRESH position inside the region's boundary — the live ops driver dots
   * (ADM-03, same staleness window as dispatch).
   *
   * @param regionId the region
   * @param cutoff now minus the stale window
   * @return the rows
   */
  @Query(
      value =
          """
          SELECT l.user_id AS "driverUserId", u.name AS "name",
                 ST_Y(l.position) AS "lat", ST_X(l.position) AS "lng",
                 l.heading_deg AS "headingDeg"
          FROM driver_locations l
          JOIN driver_profiles p ON p.user_id = l.user_id AND p.is_online
          JOIN users u ON u.user_id = l.user_id
          JOIN regions r ON r.region_id = :regionId
          WHERE l.received_at >= :cutoff AND ST_Contains(r.boundary, l.position)
          ORDER BY u.name, l.user_id
          """,
      nativeQuery = true)
  List<LiveOpsDriverRow> findFreshInRegion(
      @Param("regionId") UUID regionId, @Param("cutoff") Instant cutoff);
}
