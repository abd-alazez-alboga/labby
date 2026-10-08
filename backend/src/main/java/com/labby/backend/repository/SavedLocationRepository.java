package com.labby.backend.repository;

import com.labby.backend.model.SavedLocation;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Riders' saved places (UC-R-01). */
public interface SavedLocationRepository extends JpaRepository<SavedLocation, UUID> {

  List<SavedLocation> findByRiderUserIdOrderByNameAsc(UUID riderUserId);

  Optional<SavedLocation> findByIdAndRiderUserId(UUID id, UUID riderUserId);

  boolean existsByRiderUserIdAndNameIgnoreCase(UUID riderUserId, String name);

  boolean existsByRiderUserIdAndNameIgnoreCaseAndIdNot(UUID riderUserId, String name, UUID id);
}
