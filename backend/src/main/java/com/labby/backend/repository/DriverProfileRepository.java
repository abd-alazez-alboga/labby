package com.labby.backend.repository;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.model.DriverProfile;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Driver applications / profiles, one per account (USR-01). */
public interface DriverProfileRepository extends JpaRepository<DriverProfile, UUID> {

  Optional<DriverProfile> findByUserId(UUID userId);

  /** The application queue (UC-A-10), filtered by stage; ordering comes from the pageable. */
  Page<DriverProfile> findByApplicationStatusIn(
      Collection<ApplicationStatus> statuses, Pageable pageable);
}
