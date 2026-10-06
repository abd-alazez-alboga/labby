package com.labby.backend.repository;

import com.labby.backend.model.DriverLocation;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Drivers' latest positions (TRK-01). */
public interface DriverLocationRepository extends JpaRepository<DriverLocation, UUID> {}
