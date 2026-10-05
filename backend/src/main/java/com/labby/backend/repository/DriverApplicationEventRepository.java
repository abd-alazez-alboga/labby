package com.labby.backend.repository;

import com.labby.backend.model.DriverApplicationEvent;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Driver application stage history (UC-D-03). */
public interface DriverApplicationEventRepository
    extends JpaRepository<DriverApplicationEvent, UUID> {

  List<DriverApplicationEvent> findByDriverProfileIdOrderByCreatedAtAsc(UUID driverProfileId);
}
