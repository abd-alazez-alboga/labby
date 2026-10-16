package com.labby.backend.repository;

import com.labby.backend.model.SharedRide;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Shared-ride extensions (RIDE-P1..5). Writers lock the RIDE row first. */
public interface SharedRideRepository extends JpaRepository<SharedRide, UUID> {

  /**
   * The browse filter (UC-R-13 step 1): gathering rides of a region, near a destination, in time.
   */
  String BROWSE_FROM =
      " FROM rides r JOIN shared_rides sr ON sr.ride_id = r.ride_id"
          + " WHERE r.state = 'gathering' AND r.region_id = :regionId"
          + " AND (CAST(:destLat AS double precision) IS NULL"
          + " OR ST_DWithin(CAST(r.destination AS geography),"
          + " CAST(ST_SetSRID(ST_MakePoint(CAST(:destLng AS double precision),"
          + " CAST(:destLat AS double precision)), 4326) AS geography),"
          + " CAST(:radiusM AS double precision)))"
          + " AND (sr.departure_mode = 'when_full'"
          + " OR ((CAST(:departFrom AS timestamptz) IS NULL"
          + " OR sr.departure_at >= CAST(:departFrom AS timestamptz))"
          + " AND (CAST(:departTo AS timestamptz) IS NULL"
          + " OR sr.departure_at <= CAST(:departTo AS timestamptz))))";

  /** Browse page, soonest timed departure first, "when full" rides after them (oldest first). */
  @Query(
      value =
          "SELECT r.ride_id"
              + BROWSE_FROM
              + " ORDER BY (sr.departure_mode = 'when_full'), sr.departure_at, r.requested_at,"
              + " r.ride_id",
      countQuery = "SELECT COUNT(*)" + BROWSE_FROM,
      nativeQuery = true)
  Page<UUID> browse(
      @Param("regionId") UUID regionId,
      @Param("destLat") Double destLat,
      @Param("destLng") Double destLng,
      @Param("radiusM") Double radiusM,
      @Param("departFrom") Instant departFrom,
      @Param("departTo") Instant departTo,
      Pageable pageable);

  /** Gathering rides due now: a timed departure reached, or a "when full" ride expired. */
  @Query(
      value =
          """
          SELECT sr.ride_id FROM shared_rides sr JOIN rides r ON r.ride_id = sr.ride_id
          WHERE r.state = 'gathering'
            AND (sr.departure_at <= :now OR sr.expires_at <= :now)
          ORDER BY COALESCE(sr.departure_at, sr.expires_at)
          LIMIT :limit
          """,
      nativeQuery = true)
  List<UUID> findDue(@Param("now") Instant now, @Param("limit") int limit);

  /**
   * The largest passenger capacity among approved active vehicles serving a service type (UC-R-12
   * step 2).
   *
   * @return the seats, or 0 when no vehicle serves it
   */
  @Query(
      value =
          """
          SELECT COALESCE(MAX(v.seats), 0) FROM vehicles v
          JOIN vehicle_service_types vst ON vst.vehicle_id = v.vehicle_id
          WHERE vst.service_type_id = :serviceTypeId AND v.is_active
            AND v.review_status = 'approved'
          """,
      nativeQuery = true)
  int maxSeatsServing(@Param("serviceTypeId") UUID serviceTypeId);
}
