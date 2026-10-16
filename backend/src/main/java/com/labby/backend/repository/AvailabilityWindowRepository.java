package com.labby.backend.repository;

import com.labby.backend.model.AvailabilityWindow;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Weekly availability windows (DRV-05, UC-D-05). */
public interface AvailabilityWindowRepository extends JpaRepository<AvailabilityWindow, UUID> {

  List<AvailabilityWindow> findByDriverUserIdOrderByDayOfWeekAscStartsAtAsc(UUID driverUserId);

  /** Clears the driver's set before a replace (the whole set is sent at once). */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query("DELETE FROM AvailabilityWindow w WHERE w.driverUserId = :driverUserId")
  void deleteAllOfDriver(@Param("driverUserId") UUID driverUserId);
}
