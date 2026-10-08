package com.labby.backend.repository;

import com.labby.backend.enums.RegionState;
import com.labby.backend.model.Region;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Regions and their config bundles (ADM-01, SD-01). */
public interface RegionRepository extends JpaRepository<Region, UUID> {

  List<Region> findAllByOrderByNameAsc();

  /** Regions in a lifecycle state, name-sorted (active regions for driver approval, DRV-03). */
  List<Region> findByStateOrderByNameAsc(RegionState state);

  boolean existsByNameIgnoreCase(String name);

  /**
   * Active regions whose boundary covers the point — the SD-01 resolution query. ST_Covers (not
   * ST_Contains) so a point exactly ON the boundary resolves to the region. Region boundaries may
   * not overlap (M4-T2 rule), so more than one hit can only happen on a shared border.
   */
  @Query(
      value =
          """
          SELECT * FROM regions
          WHERE state = 'active'
            AND boundary IS NOT NULL
            AND ST_Covers(boundary, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))
          ORDER BY name
          """,
      nativeQuery = true)
  List<Region> findActiveRegionsCovering(@Param("lat") double lat, @Param("lng") double lng);

  /**
   * Whether the region's boundary covers the point (ST_Covers: the boundary counts as inside) — the
   * ride booking check that destination and stops stay inside the pickup's region (rides-v1).
   */
  @Query(
      value =
          """
          SELECT COALESCE(ST_Covers(boundary, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)), false)
          FROM regions WHERE region_id = :regionId
          """,
      nativeQuery = true)
  boolean coversPoint(
      @Param("regionId") UUID regionId, @Param("lat") double lat, @Param("lng") double lng);

  /**
   * True when another region's boundary overlaps the candidate boundary (M4-T2 rule: region
   * boundaries may not overlap). Interiors must be disjoint — ST_Intersects AND NOT ST_Touches — so
   * true overlap AND full containment are both caught, while regions sharing only a border line
   * stay legal (the resolve query breaks that tie by name).
   *
   * @param excludedRegionId the region being edited (its own boundary never conflicts); pass a nil
   *     UUID when creating
   * @param boundaryWkt the candidate boundary as WKT, SRID 4326
   * @return true when any other region's boundary overlaps it
   */
  @Query(
      value =
          """
          SELECT EXISTS (
            SELECT 1 FROM regions
            WHERE region_id <> :excludedRegionId
              AND boundary IS NOT NULL
              AND ST_Intersects(boundary, ST_GeomFromText(:boundaryWkt, 4326))
              AND NOT ST_Touches(boundary, ST_GeomFromText(:boundaryWkt, 4326))
          )
          """,
      nativeQuery = true)
  boolean existsBoundaryOverlapping(
      @Param("excludedRegionId") UUID excludedRegionId, @Param("boundaryWkt") String boundaryWkt);

  /**
   * True when the region's boundary fully covers the polygon (surge zones must lie within their
   * region, UC-A-08/M4-T2). A region without a boundary covers nothing.
   *
   * @param regionId the region
   * @param polygonWkt the candidate polygon as WKT, SRID 4326
   * @return true when the boundary covers the polygon
   */
  @Query(
      value =
          """
          SELECT CASE
                   WHEN boundary IS NULL THEN false
                   ELSE ST_Covers(boundary, ST_GeomFromText(:polygonWkt, 4326))
                 END
          FROM regions
          WHERE region_id = :regionId
          """,
      nativeQuery = true)
  boolean boundaryCovers(@Param("regionId") UUID regionId, @Param("polygonWkt") String polygonWkt);
}
