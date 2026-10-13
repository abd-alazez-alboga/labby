package com.labby.backend.repository;

import com.labby.backend.model.SurgeZone;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * A region's admin-drawn surge zones (PRC-02, UC-A-08) and their cycle state (M9): the override and
 * state columns are written only through the targeted updates below.
 */
public interface SurgeZoneRepository extends JpaRepository<SurgeZone, UUID> {

  List<SurgeZone> findByRegionIdOrderByNameAsc(UUID regionId);

  boolean existsByRegionId(UUID regionId);

  boolean existsByRegionIdAndNameIgnoreCase(UUID regionId, String name);

  boolean existsByRegionIdAndNameIgnoreCaseAndIdNot(UUID regionId, String name, UUID id);

  long countByRegionId(UUID regionId);

  /**
   * The region's zones whose polygon covers the point (the pickup-zone lookup, PRC-02). ST_Covers
   * so a point exactly ON the zone edge surges; outside every zone means 1.0×.
   */
  @Query(
      value =
          """
          SELECT * FROM surge_zones
          WHERE region_id = :regionId
            AND ST_Covers(polygon, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))
          ORDER BY name
          """,
      nativeQuery = true)
  List<SurgeZone> findZonesCovering(
      @Param("regionId") UUID regionId, @Param("lat") double lat, @Param("lng") double lng);

  /**
   * Names of the region's zones that a candidate boundary would NOT fully cover — a boundary edit
   * may not leave a zone outside its region (owner ruling 2026-10-07, UC-A-06 E1).
   *
   * @param regionId the region
   * @param boundaryWkt the candidate boundary as WKT, SRID 4326
   * @return the escaping zones' names, sorted
   */
  @Query(
      value =
          """
          SELECT name FROM surge_zones
          WHERE region_id = :regionId
            AND NOT ST_Covers(ST_GeomFromText(:boundaryWkt, 4326), polygon)
          ORDER BY name
          """,
      nativeQuery = true)
  List<String> findZoneNamesOutside(
      @Param("regionId") UUID regionId, @Param("boundaryWkt") String boundaryWkt);

  /**
   * The zones of every ACTIVE region — the surge cycle's work list (zones of draft regions keep
   * their last state).
   *
   * @return the zone ids
   */
  @Query(
      value =
          """
          SELECT z.surge_zone_id FROM surge_zones z
          JOIN regions g ON g.region_id = z.region_id AND g.state = 'active'
          ORDER BY z.region_id, z.name
          """,
      nativeQuery = true)
  List<UUID> findIdsInActiveRegions();

  /**
   * The zone locked for one surge cycle, skipped when another instance holds it (NFR-P4) or its
   * region is no longer active.
   *
   * @param surgeZoneId the zone
   * @return the zone, or empty when locked elsewhere, gone or in a draft region
   */
  @Query(
      value =
          """
          SELECT z.* FROM surge_zones z
          JOIN regions g ON g.region_id = z.region_id AND g.state = 'active'
          WHERE z.surge_zone_id = :surgeZoneId
          FOR UPDATE OF z SKIP LOCKED
          """,
      nativeQuery = true)
  Optional<SurgeZone> lockIfFree(@Param("surgeZoneId") UUID surgeZoneId);

  /**
   * One zone's surge inputs (PRC-02). Demand: the region's open requests ({@code requested} /
   * {@code offering}) whose pickup the polygon covers. Supply: idle online drivers whose latest
   * position the polygon covers, by the dispatch rules (RIDE-03, TRK-04) — approved and online,
   * active account and active driver role, an active vehicle, a FRESH stream, no open offer, no
   * assigned ride — and not floor-blocked (COM-03: the balance in the region's currency, 0 without
   * a balance row, must stay above the region floor, NULL = {@code defaultFloor}; a region without
   * a currency blocks nobody).
   *
   * @param surgeZoneId the zone
   * @param freshAfter a stream is fresh when its last sample arrived at or after this
   * @param defaultFloor the SRS floor for regions that set none
   * @return the two counts
   */
  @Query(
      value =
          """
          SELECT
            (SELECT count(*) FROM rides r
             WHERE r.region_id = z.region_id
               AND r.state IN ('requested', 'offering')
               AND ST_Covers(z.polygon, r.pickup)) AS demand,
            (SELECT count(*) FROM driver_profiles p
             JOIN users u ON u.user_id = p.user_id AND u.state = 'active'
             JOIN role_assignments ra
               ON ra.user_id = p.user_id AND ra.role = 'driver' AND ra.state = 'active'
             JOIN driver_locations l ON l.user_id = p.user_id AND l.received_at >= :freshAfter
             LEFT JOIN driver_balances b
               ON b.driver_user_id = p.user_id AND b.currency = g.currency
             WHERE p.is_online AND p.application_status = 'approved'
               AND EXISTS (SELECT 1 FROM vehicles v
                           WHERE v.driver_user_id = p.user_id AND v.is_active)
               AND ST_Covers(z.polygon, l.position)
               AND NOT EXISTS (SELECT 1 FROM ride_offers o
                               WHERE o.driver_user_id = p.user_id AND o.response IS NULL)
               AND NOT EXISTS (SELECT 1 FROM rides a WHERE a.driver_user_id = p.user_id
                               AND a.state IN ('accepted', 'driver_arrived', 'in_progress'))
               AND (g.currency IS NULL
                    OR COALESCE(b.balance, 0)
                       > COALESCE(g.driver_balance_floor, :defaultFloor))) AS supply
          FROM surge_zones z JOIN regions g ON g.region_id = z.region_id
          WHERE z.surge_zone_id = :surgeZoneId
          """,
      nativeQuery = true)
  ZoneCounts countDemandAndSupply(
      @Param("surgeZoneId") UUID surgeZoneId,
      @Param("freshAfter") Instant freshAfter,
      @Param("defaultFloor") BigDecimal defaultFloor);

  /**
   * Stores one cycle's result. Never touches the zone config nor the override.
   *
   * @return rows updated
   */
  @Modifying
  @Query(
      value =
          """
          UPDATE surge_zones
          SET computed_multiplier = :computed, current_multiplier = :current,
              demand_count = :demand, supply_count = :supply, computed_at = :computedAt
          WHERE surge_zone_id = :surgeZoneId
          """,
      nativeQuery = true)
  int storeCycle(
      @Param("surgeZoneId") UUID surgeZoneId,
      @Param("computed") BigDecimal computed,
      @Param("current") BigDecimal current,
      @Param("demand") int demand,
      @Param("supply") int supply,
      @Param("computedAt") Instant computedAt);

  /**
   * Sets the UC-A-09 manual override; the cycle applies it next time it runs.
   *
   * @return rows updated
   */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query(
      value =
          """
          UPDATE surge_zones
          SET override_multiplier = :multiplier, override_set_by = :setBy, override_set_at = :setAt
          WHERE surge_zone_id = :surgeZoneId
          """,
      nativeQuery = true)
  int setOverride(
      @Param("surgeZoneId") UUID surgeZoneId,
      @Param("multiplier") BigDecimal multiplier,
      @Param("setBy") UUID setBy,
      @Param("setAt") Instant setAt);

  /**
   * Resets the zone to automatic (UC-A-09); the cycle applies it next time it runs.
   *
   * @return rows updated
   */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query(
      value =
          """
          UPDATE surge_zones
          SET override_multiplier = NULL, override_set_by = NULL, override_set_at = NULL
          WHERE surge_zone_id = :surgeZoneId
          """,
      nativeQuery = true)
  int clearOverride(@Param("surgeZoneId") UUID surgeZoneId);

  /** One zone's demand and supply counts. */
  interface ZoneCounts {
    long getDemand();

    long getSupply();
  }
}
