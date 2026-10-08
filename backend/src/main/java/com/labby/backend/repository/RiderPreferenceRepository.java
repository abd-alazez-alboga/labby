package com.labby.backend.repository;

import com.labby.backend.model.RiderPreference;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Rider comfort preferences + matching toggle (USR-03); no row = defaults. */
public interface RiderPreferenceRepository extends JpaRepository<RiderPreference, UUID> {}
