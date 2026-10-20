package com.labby.backend.service;

import com.labby.backend.enums.FloorStatus;
import com.labby.backend.model.Region;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * Duty gates: the COM-03 balance floor blocks offers when the driver's balance in the region's
 * currency is at/below the region's floor (M8); an assigned ride forbids going offline (M7,
 * UC-D-04).
 */
@Service
@RequiredArgsConstructor
public class DriverDutyGatesImpl implements DriverDutyGates {

  /** UC-D-04 E2: online, but the balance floor stops offers until settlement. */
  static final String BALANCE_BELOW_FLOOR = "balance_below_floor";

  private final RideRepository rideRepository;
  private final RegionRepository regionRepository;
  private final MoneyFloors moneyFloors;

  @Override
  public String offersBlockedReason(UUID driverUserId) {
    return moneyFloors
        .operatingRegion(driverUserId)
        .map(region -> blockedReason(driverUserId, region))
        .orElse(null);
  }

  @Override
  public String offersBlockedReason(UUID driverUserId, UUID regionId) {
    return regionRepository
        .findById(regionId)
        .map(region -> blockedReason(driverUserId, region))
        .orElse(null);
  }

  private String blockedReason(UUID driverUserId, Region region) {
    if (region.getCurrency() == null) {
      return null;
    }
    FloorStatus status =
        moneyFloors.status(
            moneyFloors.balance(driverUserId, region.getCurrency()), moneyFloors.rule(region));
    return status == FloorStatus.BLOCKED ? BALANCE_BELOW_FLOOR : null;
  }

  @Override
  public boolean hasActiveRide(UUID driverUserId) {
    return rideRepository.existsByDriverUserIdAndStateIn(
        driverUserId, RideRepository.ASSIGNED_STATES);
  }
}
