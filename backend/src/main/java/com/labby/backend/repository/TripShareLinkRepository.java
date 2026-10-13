package com.labby.backend.repository;

import com.labby.backend.model.TripShareLink;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Trip-share links (SHARE-01/02): hash-addressed, one per user per ride. */
public interface TripShareLinkRepository extends JpaRepository<TripShareLink, UUID> {

  Optional<TripShareLink> findByTokenHash(String tokenHash);

  boolean existsByRideIdAndCreatedByUserId(UUID rideId, UUID createdByUserId);
}
