package com.labby.backend.repository;

import com.labby.backend.model.Region;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Regions and their config bundles (ADM-01, SD-01). */
public interface RegionRepository extends JpaRepository<Region, UUID> {

  List<Region> findAllByOrderByNameAsc();

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
}
