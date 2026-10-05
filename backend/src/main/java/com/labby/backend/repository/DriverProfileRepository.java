package com.labby.backend.repository;

import com.labby.backend.model.DriverProfile;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Driver applications / profiles, one per account (USR-01). */
public interface DriverProfileRepository extends JpaRepository<DriverProfile, UUID> {

  Optional<DriverProfile> findByUserId(UUID userId);
}
