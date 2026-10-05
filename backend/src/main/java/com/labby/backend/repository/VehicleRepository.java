package com.labby.backend.repository;

import com.labby.backend.model.Vehicle;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Drivers' vehicles (DRV-03). */
public interface VehicleRepository extends JpaRepository<Vehicle, UUID> {

  /** The driver's single active vehicle, if any. */
  Optional<Vehicle> findByDriverUserIdAndActiveTrue(UUID driverUserId);

  List<Vehicle> findByDriverUserIdOrderByCreatedAtDesc(UUID driverUserId);

  /** Duplicate-plate check (UC-D-01 E3 / UC-A-10 E1): the plate on ANOTHER driver's active car. */
  boolean existsByPlateAndActiveTrueAndDriverUserIdNot(String plate, UUID driverUserId);
}
