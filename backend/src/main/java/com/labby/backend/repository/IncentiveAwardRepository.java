package com.labby.backend.repository;

import com.labby.backend.enums.IncentiveKind;
import com.labby.backend.model.IncentiveAward;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Paid DRV-08 incentives (V31). */
public interface IncentiveAwardRepository extends JpaRepository<IncentiveAward, UUID> {

  /** Whether this week's award of the kind was already paid (the exactly-once check). */
  boolean existsByDriverUserIdAndRegionIdAndWeekStartAndKind(
      UUID driverUserId, UUID regionId, LocalDate weekStart, IncentiveKind kind);

  /** A driver's last 8 awards in a region, newest week first (the driver screen). */
  List<IncentiveAward> findTop8ByDriverUserIdAndRegionIdOrderByWeekStartDescCreatedAtDesc(
      UUID driverUserId, UUID regionId);
}
