package com.labby.backend.service;

import com.labby.backend.dto.EstimateDto;
import com.labby.backend.dto.PlaceDto;
import com.labby.backend.dto.RouteDto;
import com.labby.backend.enums.ClaimReleaseReason;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.ScheduledClaimRelease;
import com.labby.backend.model.ScheduledRide;
import com.labby.backend.model.ServiceType;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.ScheduledClaimReleaseRepository;
import com.labby.backend.repository.ScheduledRideRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Shared steps of the scheduled-ride services and the clock job (scheduled-shared-v1.yaml): the
 * region timing, re-pricing at execution, reminder-tier bookkeeping, releasing a claim and the
 * pickup-time push params. Callers hold the RIDE row lock.
 */
@Component
@RequiredArgsConstructor
public class ScheduledRideSupport {

  private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");
  private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

  private final RegionRepository regionRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final ScheduledRideRepository scheduledRideRepository;
  private final ScheduledClaimReleaseRepository scheduledClaimReleaseRepository;
  private final RidePricing ridePricing;
  private final RideAssembler rideAssembler;
  private final RideEvents rideEvents;

  /**
   * The ride's region.
   *
   * @param ride the ride
   * @return its region
   */
  public Region region(Ride ride) {
    return regionRepository.findById(ride.getRegionId()).orElseThrow();
  }

  /**
   * The timing of a region (null = SRS defaults).
   *
   * @param region the region
   * @return the settings
   */
  public ScheduledRules.Settings settings(Region region) {
    return ScheduledRules.settings(region.getScheduledSettings());
  }

  /**
   * Marks the reminder tiers whose moment is already past as handled, without a push (a tier is
   * only sent when its moment is after the booking / the claim — scheduled-shared-v1 Reminders).
   *
   * @param scheduled the extension
   * @param settings the region timing
   * @param now the booking or claim moment
   * @param driver true for the claiming driver's marks, false for the rider's
   */
  public void skipPastTiers(
      ScheduledRide scheduled, ScheduledRules.Settings settings, Instant now, boolean driver) {
    Instant at = scheduled.getScheduledAt();
    if (!settings.firstReminderAt(at).isAfter(now)) {
      if (driver) {
        scheduled.setDriverReminderFirstAt(now);
      } else {
        scheduled.setRiderReminderFirstAt(now);
      }
    }
    if (!settings.secondReminderAt(at).isAfter(now)) {
      if (driver) {
        scheduled.setDriverReminderSecondAt(now);
      } else {
        scheduled.setRiderReminderSecondAt(now);
      }
    }
  }

  /**
   * Re-prices a ride entering live (S3 conversion / S4 fallback, scheduled-shared-v1): the pickup
   * zone's surge NOW is locked, the surcharge stays the one of the pickup time's window, and the
   * estimate is recomputed.
   *
   * @param ride the ride (locked)
   * @param region its region
   * @param scheduledAt the pickup time
   */
  public void repriceForExecution(Ride ride, Region region, Instant scheduledAt) {
    PlaceDto pickup = rideAssembler.place(ride.getPickup(), ride.getPickupLabel());
    PlaceDto destination = rideAssembler.place(ride.getDestination(), ride.getDestinationLabel());
    BigDecimal surge = ridePricing.surgeAt(region, pickup).multiplier();
    BigDecimal surcharge = ridePricing.surchargePercentAt(region, scheduledAt);
    ServiceType serviceType = serviceTypeRepository.findById(ride.getServiceTypeId()).orElseThrow();
    RouteDto route = ridePricing.route(pickup, rideAssembler.stops(ride.getStops()), destination);
    EstimateDto estimate =
        ridePricing.estimate(serviceType, ride.getCurrency(), route, surcharge, surge);
    ride.setSurgeMultiplier(surge);
    ride.setSurchargePercent(surcharge);
    applyEstimate(ride, estimate);
  }

  /**
   * Stores an estimate on the ride (the rides-v1 booking fields).
   *
   * @param ride the ride
   * @param estimate the estimate
   */
  public void applyEstimate(Ride ride, EstimateDto estimate) {
    ride.setEstimateTotal(estimate.components().total());
    ride.setEstimateDistanceM((int) estimate.distanceMeters());
    ride.setEstimateDurationS((int) estimate.durationSeconds());
    ride.setEstimateApproximate(estimate.approximate());
    ride.setEstimateComponents(rideAssembler.componentsMap(estimate.components()));
  }

  /**
   * Gives a claim back (UC-D-12 E1): the release is recorded (the cancellation-metric trail), the
   * claim and the driver's reminder marks are cleared, the rider is told. The ride stays on the
   * board; the clock job falls it back at T − lead if nobody claims it again.
   *
   * @param ride the ride (locked)
   * @param scheduled its extension (claimed)
   * @param reason why
   * @param note the note ({@code other}), or null
   * @param now the moment
   */
  public void release(
      Ride ride, ScheduledRide scheduled, ClaimReleaseReason reason, String note, Instant now) {
    scheduledClaimReleaseRepository.save(
        ScheduledClaimRelease.builder()
            .rideId(ride.getId())
            .driverUserId(scheduled.getClaimedDriverUserId())
            .claimedAt(scheduled.getClaimedAt())
            .releasedAt(now)
            .reason(reason)
            .note(note)
            .build());
    scheduled.clearClaim();
    scheduledRideRepository.saveAndFlush(scheduled);
    rideEvents.push(
        ride.getRiderUserId(),
        NotificationEvent.SCHEDULED_RELEASED,
        pickupParams(ride, scheduled, region(ride)));
    rideEvents.updated(ride, "scheduled_released");
  }

  /**
   * Push params naming the pickup moment in the region's time zone (Western digits).
   *
   * @param ride the ride
   * @param scheduled its extension
   * @param region its region
   * @return rideId, pickupDate (yyyy-MM-dd), pickupTime (HH:mm)
   */
  public Map<String, Object> pickupParams(Ride ride, ScheduledRide scheduled, Region region) {
    ZonedDateTime local = scheduled.getScheduledAt().atZone(ZoneId.of(region.getTimeZone()));
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("rideId", ride.getId().toString());
    params.put("pickupDate", DATE.format(local));
    params.put("pickupTime", TIME.format(local));
    return params;
  }
}
