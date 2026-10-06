package com.labby.backend.service;

import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * V1 duty gates: no balance floor yet (arrives with the wallet in M8) and no rides yet (M7), so
 * nothing blocks offers or going offline.
 */
@Service
public class DriverDutyGatesImpl implements DriverDutyGates {

  @Override
  public String offersBlockedReason(UUID driverUserId) {
    return null;
  }

  @Override
  public boolean hasActiveRide(UUID driverUserId) {
    return false;
  }
}
