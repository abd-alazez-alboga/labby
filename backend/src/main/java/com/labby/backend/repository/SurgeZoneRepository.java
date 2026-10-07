package com.labby.backend.repository;

import com.labby.backend.model.SurgeZone;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** A region's admin-drawn surge zones (PRC-02, UC-A-08). */
public interface SurgeZoneRepository extends JpaRepository<SurgeZone, UUID> {

  List<SurgeZone> findByRegionIdOrderByNameAsc(UUID regionId);

  boolean existsByRegionId(UUID regionId);

  boolean existsByRegionIdAndNameIgnoreCase(UUID regionId, String name);

  boolean existsByRegionIdAndNameIgnoreCaseAndIdNot(UUID regionId, String name, UUID id);

  long countByRegionId(UUID regionId);

  /**
   * The region's zones whose polygon covers the point (pickup-zone lookup for M9). ST_Covers so a
   * point exactly ON the zone edge surges; outside every zone means 1.0× (PRC-02 A1).
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
}
