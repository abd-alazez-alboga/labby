package com.labby.backend.repository;

import com.labby.backend.model.SurchargeWindow;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** A region's time-window fare surcharges (PRC-01). */
public interface SurchargeWindowRepository extends JpaRepository<SurchargeWindow, UUID> {

  List<SurchargeWindow> findByRegionIdOrderByStartsAtAsc(UUID regionId);
}
