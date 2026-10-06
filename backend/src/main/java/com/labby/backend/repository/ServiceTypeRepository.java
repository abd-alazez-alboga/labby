package com.labby.backend.repository;

import com.labby.backend.model.ServiceType;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** A region's service types with their pricing (PRC-01, UC-A-07). */
public interface ServiceTypeRepository extends JpaRepository<ServiceType, UUID> {

  List<ServiceType> findByRegionIdOrderByNameEnAsc(UUID regionId);

  List<ServiceType> findByRegionIdAndEnabledTrueOrderByNameEnAsc(UUID regionId);

  boolean existsByRegionIdAndNameEnIgnoreCase(UUID regionId, String nameEn);

  boolean existsByRegionIdAndNameEnIgnoreCaseAndIdNot(UUID regionId, String nameEn, UUID id);

  boolean existsByRegionIdAndEnabledTrue(UUID regionId);

  long countByRegionId(UUID regionId);

  /** Enabled service types of the given regions (assignable at driver approval, DRV-03). */
  List<ServiceType> findByRegionIdInAndEnabledTrue(Collection<UUID> regionIds);
}
