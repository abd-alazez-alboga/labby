package com.labby.backend.repository;

import com.labby.backend.model.Fare;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Stored final fares (PRC-04), one per completed ride. */
public interface FareRepository extends JpaRepository<Fare, UUID> {

  List<Fare> findByRideIdIn(Collection<UUID> rideIds);
}
