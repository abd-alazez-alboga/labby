package com.labby.backend.repository;

import com.labby.backend.model.ScheduledClaimRelease;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** The append-only trail of released scheduled-ride claims (UC-D-12 E1). */
public interface ScheduledClaimReleaseRepository
    extends JpaRepository<ScheduledClaimRelease, UUID> {}
