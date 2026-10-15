package com.labby.backend.repository;

import com.labby.backend.model.RatingSnapshot;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** RATE-02 exposed averages, rewritten daily. */
public interface RatingSnapshotRepository
    extends JpaRepository<RatingSnapshot, RatingSnapshot.Key> {

  List<RatingSnapshot> findByUserId(UUID userId);
}
