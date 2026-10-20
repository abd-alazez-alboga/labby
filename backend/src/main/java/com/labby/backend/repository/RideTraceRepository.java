package com.labby.backend.repository;

import com.labby.backend.model.RideTrace;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Ride GPS traces (TRK-03): appended per sample, read for metering, receipts and admin review. */
public interface RideTraceRepository extends JpaRepository<RideTrace, Long> {

  /** Appends one sample in a single statement (location ingestion stays cheap, NFR-P2). */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO ride_traces
            (ride_id, phase, position, accuracy_m, speed_mps, heading_deg, recorded_at, received_at)
          VALUES (:rideId, :phase, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                  CAST(:accuracyM AS real), CAST(:speedMps AS real), CAST(:headingDeg AS real),
                  :recordedAt, :receivedAt)
          """,
      nativeQuery = true)
  int append(
      @Param("rideId") UUID rideId,
      @Param("phase") String phase,
      @Param("lat") double lat,
      @Param("lng") double lng,
      @Param("accuracyM") Double accuracyM,
      @Param("speedMps") Double speedMps,
      @Param("headingDeg") Double headingDeg,
      @Param("recordedAt") Instant recordedAt,
      @Param("receivedAt") Instant receivedAt);

  /**
   * The metered distance (RIDE-06): the sum of great-circle lengths between consecutive {@code
   * in_ride} samples in device-time order. A gap contributes the straight segment across it.
   *
   * @return meters (0 with fewer than two samples)
   */
  @Query(
      value =
          """
          SELECT COALESCE(SUM(ST_Distance(prev::geography, position::geography)), 0)
          FROM (SELECT position,
                       LAG(position) OVER (ORDER BY recorded_at, ride_trace_id) AS prev
                FROM ride_traces WHERE ride_id = :rideId AND phase = 'in_ride') segments
          WHERE prev IS NOT NULL
          """,
      nativeQuery = true)
  double meteredDistanceMeters(@Param("rideId") UUID rideId);

  /**
   * Whether the ride's in-ride trace came within {@code meters} of a point (V1 audit W40: a stop
   * counts as visited, so the ETA no longer routes through it).
   *
   * @return true when a sample was that close
   */
  @Query(
      value =
          """
          SELECT EXISTS (
            SELECT 1 FROM ride_traces
            WHERE ride_id = :rideId AND phase = 'in_ride'
              AND ST_DWithin(position::geography,
                             ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :meters))
          """,
      nativeQuery = true)
  boolean passedNear(
      @Param("rideId") UUID rideId,
      @Param("lat") double lat,
      @Param("lng") double lng,
      @Param("meters") double meters);

  List<RideTrace> findByRideIdOrderByRecordedAtAscIdAsc(UUID rideId);
}
