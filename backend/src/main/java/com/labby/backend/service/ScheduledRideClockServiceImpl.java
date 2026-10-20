package com.labby.backend.service;

import com.labby.backend.config.ScheduledProperties;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.ClaimReleaseReason;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.OfferResponse;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RideOffer;
import com.labby.backend.model.ScheduledRide;
import com.labby.backend.model.User;
import com.labby.backend.model.Vehicle;
import com.labby.backend.repository.DriverProfileRepository;
import com.labby.backend.repository.RideOfferRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.ScheduledRideRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.repository.VehicleRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The scheduled-ride clock job's work (RIDE-S3/S4). Each due ride is handled in its own transaction
 * with its row locked {@code FOR UPDATE SKIP LOCKED}, so several instances never act twice and a
 * crash rolls the whole step back; a job that was down catches up on its next tick (a ride is never
 * left in {@code scheduled} past its execution moment).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScheduledRideClockServiceImpl implements ScheduledRideClockService {

  private final ScheduledRideRepository scheduledRideRepository;
  private final RideRepository rideRepository;
  private final SharedRideMemberRepository sharedRideMemberRepository;
  private final DriverProfileRepository driverProfileRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final UserRepository userRepository;
  private final VehicleRepository vehicleRepository;
  private final RideOfferRepository rideOfferRepository;
  private final DriverDutyGates driverDutyGates;
  private final ScheduledRideSupport scheduledRideSupport;
  private final RideLifecycle rideLifecycle;
  private final RideEvents rideEvents;
  private final ChatService chatService;
  private final ScheduledProperties scheduledProperties;
  private final TransactionTemplate transactionTemplate;
  private final Clock clock;

  @Override
  public int processDue() {
    int changed = 0;
    List<UUID> due =
        scheduledRideRepository.findDue(clock.instant(), scheduledProperties.batchSize());
    for (UUID rideId : due) {
      try {
        if (Boolean.TRUE.equals(transactionTemplate.execute(status -> step(rideId)))) {
          changed++;
        }
      } catch (RuntimeException ex) {
        log.warn("Scheduled ride step failed for {}: {}", rideId, ex.getClass().getSimpleName());
      }
    }
    return changed;
  }

  private boolean step(UUID rideId) {
    Optional<Ride> locked = rideRepository.lockIfFree(rideId);
    if (locked.isEmpty() || locked.get().getState() != RideState.SCHEDULED) {
      return false;
    }
    Ride ride = locked.get();
    Optional<ScheduledRide> found = scheduledRideRepository.findById(rideId);
    if (found.isEmpty() || found.get().isExecuted()) {
      return false;
    }
    ScheduledRide scheduled = found.get();
    Instant now = clock.instant();
    Region region = scheduledRideSupport.region(ride);
    ScheduledRules.Settings settings = scheduledRideSupport.settings(region);
    if (!now.isBefore(settings.executeAt(scheduled.getScheduledAt()))) {
      return execute(ride, scheduled, region, now);
    }
    boolean changed = remind(ride, scheduled, region, settings, now, false);
    if (scheduled.isClaimed()) {
      changed |= remind(ride, scheduled, region, settings, now, true);
    }
    if (changed) {
      scheduledRideRepository.saveAndFlush(scheduled);
    }
    return changed;
  }

  /**
   * RIDE-S3 reminders of one party: every due, unhandled tier is marked; only the LATEST due one is
   * pushed (a job that was down across both tiers sends one reminder, not two).
   */
  private boolean remind(
      Ride ride,
      ScheduledRide scheduled,
      Region region,
      ScheduledRules.Settings settings,
      Instant now,
      boolean driver) {
    Instant at = scheduled.getScheduledAt();
    boolean firstDue =
        (driver ? scheduled.getDriverReminderFirstAt() : scheduled.getRiderReminderFirstAt())
                == null
            && !settings.firstReminderAt(at).isAfter(now);
    boolean secondDue =
        (driver ? scheduled.getDriverReminderSecondAt() : scheduled.getRiderReminderSecondAt())
                == null
            && !settings.secondReminderAt(at).isAfter(now);
    if (!firstDue && !secondDue) {
      return false;
    }
    if (firstDue) {
      if (driver) {
        scheduled.setDriverReminderFirstAt(now);
      } else {
        scheduled.setRiderReminderFirstAt(now);
      }
    }
    if (secondDue) {
      if (driver) {
        scheduled.setDriverReminderSecondAt(now);
      } else {
        scheduled.setRiderReminderSecondAt(now);
      }
    }
    Map<String, Object> params = scheduledRideSupport.pickupParams(ride, scheduled, region);
    params.put("as", driver ? "driver" : "rider");
    params.put(
        "minutesBefore", secondDue ? settings.reminderSecondMin() : settings.reminderFirstMin());
    rideEvents.push(
        driver ? scheduled.getClaimedDriverUserId() : ride.getRiderUserId(),
        NotificationEvent.SCHEDULED_REMINDER,
        params);
    return true;
  }

  /**
   * T − lead: rider busy → cancel; claimed + available driver → S3; otherwise → S4. Returns false
   * (nothing changed, the next tick retries) only when the claimer's open live offer belongs to a
   * ride another transaction holds right now.
   */
  private boolean execute(Ride ride, ScheduledRide scheduled, Region region, Instant now) {
    // Under the rider's own lock (ride row → rider lock, the join order): a membership committing
    // at this moment is either seen here or waits (review re-audit N4).
    rideRepository.lockRider(ride.getRiderUserId());
    if (riderBusy(ride.getRiderUserId())) {
      cancelRiderBusy(ride, scheduled, region, now);
      return true;
    }
    if (scheduled.isClaimed()) {
      UUID driver = scheduled.getClaimedDriverUserId();
      String floorBlocked =
          driverAvailable(driver)
              ? driverDutyGates.offersBlockedReason(driver, ride.getRegionId())
              : null;
      if (floorBlocked != null) {
        // V1 audit H7 (owner ruling 2026-10-20): the COM-03 floor blocks conversion too — the
        // system releases the claim (not a metric event), the driver is told, the ride falls back.
        Map<String, Object> params = driverNoticeParams(ride, scheduled, region);
        scheduledRideSupport.release(
            ride, scheduled, ClaimReleaseReason.BALANCE_BELOW_FLOOR, null, now);
        pushDriverRelease(driver, params, floorBlocked, false);
      } else if (driverAvailable(driver)) {
        Optional<UUID> vehicle = conversionVehicle(ride, scheduled);
        if (vehicle.isPresent()) {
          // Review H1 (owner ruling 2026-10-17, "the claim wins"): the claimer's open live offer
          // is withdrawn first, so the driver is never bound to two rides.
          if (!withdrawOpenOffer(driver, now)) {
            return false;
          }
          convert(ride, scheduled, region, vehicle.get(), now);
          return true;
        }
        // Review W3 (owner ruling 2026-10-17): the current vehicle no longer serves the ride —
        // the system releases the claim, not a cancellation-metric event, the driver is told.
        Map<String, Object> params = driverNoticeParams(ride, scheduled, region);
        params.put("reason", ClaimReleaseReason.VEHICLE_CHANGED.getValue());
        params.put("countsAsRelease", "false");
        scheduledRideSupport.release(
            ride, scheduled, ClaimReleaseReason.VEHICLE_CHANGED, null, now);
        rideEvents.push(driver, NotificationEvent.SCHEDULED_CLAIM_LOST, params);
      } else {
        // Ruling 2026-10-16: an offline / busy / suspended claimer loses the claim; the ride takes
        // the fallback. A suspension is not a metric event, offline/busy counts like a release.
        boolean suspended = suspended(driver);
        Map<String, Object> params = driverNoticeParams(ride, scheduled, region);
        scheduledRideSupport.release(
            ride,
            scheduled,
            suspended ? ClaimReleaseReason.ACCOUNT_SUSPENDED : ClaimReleaseReason.OTHER,
            suspended ? null : "unavailable_at_conversion",
            now);
        // V1 audit W42: the claimer is told the system released the claim (and whether it
        // counts as a release in their cancellation metric, W22).
        pushDriverRelease(
            driver,
            params,
            suspended ? ClaimReleaseReason.ACCOUNT_SUSPENDED.getValue() : "unavailable",
            !suspended);
      }
    }
    fallBack(ride, scheduled, region, now);
    return true;
  }

  /**
   * The rider is on another live ride, or holds a live or still-gathering shared membership (review
   * H2, owner ruling 2026-10-17: gathering counts as busy).
   */
  private boolean riderBusy(UUID riderUserId) {
    return rideRepository.findOwnActive(riderUserId, RideRepository.ACTIVE_STATES).isPresent()
        || sharedRideMemberRepository.existsOpenMembership(riderUserId);
  }

  /**
   * Review W3: the claimed vehicle when it is still the active one, else the driver's current
   * active vehicle when it serves the ride's service type.
   */
  private Optional<UUID> conversionVehicle(Ride ride, ScheduledRide scheduled) {
    UUID driver = scheduled.getClaimedDriverUserId();
    return vehicleRepository
        .findByDriverUserIdAndActiveTrue(driver)
        .map(Vehicle::getId)
        .filter(
            vehicleId ->
                vehicleId.equals(scheduled.getClaimedVehicleId())
                    || scheduledRideRepository
                        .eligibility(ride.getId(), driver)
                        .getServiceTypeMatches());
  }

  /**
   * Withdraws the driver's open live offer, locking its ride without waiting; false when that ride
   * is held by another transaction (e.g. the driver accepting it this very moment).
   */
  private boolean withdrawOpenOffer(UUID driverUserId, Instant now) {
    Optional<RideOffer> open =
        rideOfferRepository.findFirstByDriverUserIdAndResponseIsNull(driverUserId);
    if (open.isEmpty()) {
      return true;
    }
    Optional<Ride> offered = rideRepository.lockIfFree(open.get().getRideId());
    if (offered.isEmpty()) {
      return false;
    }
    // Re-read under the ride's lock: its dispatch may have closed that offer and offered the
    // ride to someone else meanwhile — only the claimer's still-open offer is withdrawn.
    rideOfferRepository
        .findById(open.get().getId())
        .filter(offer -> offer.getResponse() == null)
        .ifPresent(
            offer -> {
              offer.setResponse(OfferResponse.WITHDRAWN);
              offer.setRespondedAt(now);
              rideOfferRepository.saveAndFlush(offer);
              rideEvents.offerWithdrawn(offer, "scheduled_converted");
            });
    return true;
  }

  /** S3: the claimed ride becomes a live {@code accepted} ride with its driver bound. */
  private void convert(
      Ride ride, ScheduledRide scheduled, Region region, UUID vehicleId, Instant now) {
    scheduledRideSupport.repriceForExecution(ride, region, scheduled.getScheduledAt());
    ride.setState(RideState.ACCEPTED);
    ride.setAcceptedAt(now);
    ride.setDriverUserId(scheduled.getClaimedDriverUserId());
    ride.setVehicleId(vehicleId);
    // Free until live (ruling 2026-10-16); from here RIDE-07 applies with its grace.
    ride.setCancellationGraceEndsAt(rideLifecycle.cancellationGraceEnd(ride, now));
    ride = rideRepository.saveAndFlush(ride);
    scheduled.setConvertedAt(now);
    scheduledRideRepository.saveAndFlush(scheduled);
    chatService.openThread(ride, now);
    rideEvents.stateChanged(ride);
    for (Map.Entry<UUID, String> party :
        Map.of(ride.getRiderUserId(), "rider", ride.getDriverUserId(), "driver").entrySet()) {
      rideEvents.push(
          party.getKey(),
          NotificationEvent.SCHEDULED_CONVERTED,
          Map.of("rideId", ride.getId().toString(), "as", party.getValue()));
    }
  }

  /**
   * S4: unclaimed → normal live dispatch. {@code requested_at} restarts now (approved plan) so the
   * rides-v1 give-up clock counts from the moment dispatch begins.
   */
  private void fallBack(Ride ride, ScheduledRide scheduled, Region region, Instant now) {
    scheduledRideSupport.repriceForExecution(ride, region, scheduled.getScheduledAt());
    ride.setState(RideState.REQUESTED);
    ride.setRequestedAt(now);
    ride = rideRepository.saveAndFlush(ride);
    scheduled.setFallbackAt(now);
    scheduledRideRepository.saveAndFlush(scheduled);
    rideEvents.stateChanged(ride);
  }

  /**
   * The params of a driver-audience scheduled notice (V1 audit W22): the ride, its pickup date and
   * time in the region's zone and the rider's first name, so the app can title the notice.
   */
  private Map<String, Object> driverNoticeParams(
      Ride ride, ScheduledRide scheduled, Region region) {
    Map<String, Object> params = scheduledRideSupport.pickupParams(ride, scheduled, region);
    params.put("riderFirstName", riderFirstName(ride.getRiderUserId()));
    params.put("as", "driver");
    return params;
  }

  /** V1 audit W42: the driver-audience {@code scheduled.released} of a system release. */
  private void pushDriverRelease(
      UUID driverUserId, Map<String, Object> params, String reason, boolean countsAsRelease) {
    params.put("reason", reason);
    params.put("countsAsRelease", String.valueOf(countsAsRelease));
    rideEvents.push(driverUserId, NotificationEvent.SCHEDULED_RELEASED, params);
  }

  private String riderFirstName(UUID riderUserId) {
    return userRepository
        .findById(riderUserId)
        .map(User::getName)
        .map(RideAssembler::firstName)
        .orElse("");
  }

  /** Ruling 2026-10-16: the rider is on another live ride — cancelled free, both told. */
  private void cancelRiderBusy(Ride ride, ScheduledRide scheduled, Region region, Instant now) {
    ride.setState(RideState.CANCELLED_BY_RIDER);
    ride.setCancelledAt(now);
    ride.setCancellationReason(CancellationReason.RIDER_BUSY);
    ride.setCancellationFee(null);
    ride = rideRepository.saveAndFlush(ride);
    rideEvents.stateChanged(ride);
    rideEvents.push(
        ride.getRiderUserId(),
        NotificationEvent.SCHEDULED_CANCELLED_RIDER_BUSY,
        Map.of("rideId", ride.getId().toString(), "as", "rider"));
    if (scheduled.isClaimed()) {
      // V1 audit W22: the driver's notice names the pickup time and the rider.
      rideEvents.push(
          scheduled.getClaimedDriverUserId(),
          NotificationEvent.SCHEDULED_CANCELLED_RIDER_BUSY,
          driverNoticeParams(ride, scheduled, region));
    }
  }

  /** Online, role + account active, not on an assigned ride (the vehicle is checked apart). */
  private boolean driverAvailable(UUID driverUserId) {
    boolean online =
        driverProfileRepository
            .findByUserId(driverUserId)
            .map(profile -> profile.isOnline())
            .orElse(false);
    return online && !suspended(driverUserId) && !driverDutyGates.hasActiveRide(driverUserId);
  }

  private boolean suspended(UUID driverUserId) {
    boolean roleSuspended =
        roleAssignmentRepository
            .findByUserIdAndRole(driverUserId, Role.DRIVER)
            .map(role -> role.getState() != RoleState.ACTIVE)
            .orElse(true);
    boolean accountSuspended =
        userRepository
            .findById(driverUserId)
            .map(user -> user.getState() != AccountState.ACTIVE)
            .orElse(true);
    return roleSuspended || accountSuspended;
  }
}
