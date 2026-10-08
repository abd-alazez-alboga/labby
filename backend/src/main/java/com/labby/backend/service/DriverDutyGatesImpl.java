package com.labby.backend.service;

import com.labby.backend.repository.RideRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * Duty gates: no balance floor yet (arrives with the wallet in M8); an assigned ride (accepted,
 * driver arrived, in progress) forbids going offline (M7, UC-D-04).
 */
@Service
@RequiredArgsConstructor
public class DriverDutyGatesImpl implements DriverDutyGates {

  private final RideRepository rideRepository;

  @Override
  public String offersBlockedReason(UUID driverUserId) {
    return null;
  }

  @Override
  public boolean hasActiveRide(UUID driverUserId) {
    return rideRepository.existsByDriverUserIdAndStateIn(
        driverUserId, RideRepository.ASSIGNED_STATES);
  }
}
