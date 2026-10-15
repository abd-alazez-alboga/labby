package com.labby.backend.repository;

import com.labby.backend.enums.DriverMetric;
import com.labby.backend.model.DriverMetricWarning;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

/** DRV-07 warning intervals; at most one active per driver x metric (V17). */
public interface DriverMetricWarningRepository extends JpaRepository<DriverMetricWarning, UUID> {

  List<DriverMetricWarning> findByDriverUserIdAndClearedAtIsNullOrderByRaisedAtAsc(
      UUID driverUserId);

  Optional<DriverMetricWarning> findByDriverUserIdAndMetricAndClearedAtIsNull(
      UUID driverUserId, DriverMetric metric);

  /** Drivers holding an active warning (re-evaluated so a recovered metric clears). */
  @Query("SELECT DISTINCT w.driverUserId FROM DriverMetricWarning w WHERE w.clearedAt IS NULL")
  List<UUID> findDriversWithActiveWarnings();
}
