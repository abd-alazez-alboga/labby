package com.labby.backend.service;

import com.labby.backend.dto.EstimateDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RouteDto;
import com.labby.backend.dto.ScheduleRideRequestDto;
import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.ClaimReleaseReason;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RiderPreference;
import com.labby.backend.model.ScheduledRide;
import com.labby.backend.model.ServiceType;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RiderPreferenceRepository;
import com.labby.backend.repository.ScheduledRideRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import com.labby.backend.service.RideAssembler.Audience;
import com.labby.backend.util.GeoPoints;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Scheduling (RIDE-S1, UC-R-10/11). A scheduled ride is an ordinary ride in the pre-live state
 * {@code scheduled}: it holds no driver and is not the rider's active ride, so it never blocks an
 * on-demand booking. Cancellation goes through the rides-v1 rider cancel (always free here).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class ScheduledRideServiceImpl implements ScheduledRideService {

  private final RideAccess rideAccess;
  private final RidePricing ridePricing;
  private final RideAssembler rideAssembler;
  private final RideEvents rideEvents;
  private final RideLifecycle rideLifecycle;
  private final ScheduledRideSupport scheduledRideSupport;
  private final RideRepository rideRepository;
  private final ScheduledRideRepository scheduledRideRepository;
  private final SharedRideMemberRepository sharedRideMemberRepository;
  private final ServiceTypeRepository serviceTypeRepository;
  private final RiderPreferenceRepository riderPreferenceRepository;
  private final Clock clock;

  @Override
  public RideDto schedule(UUID userId, ScheduleRideRequestDto request) {
    rideAccess.requireActiveRider(userId);
    Region region = ridePricing.regionOf(request.pickup());
    ridePricing.checkRoute(region, request.destination(), request.stops());
    ServiceType serviceType =
        serviceTypeRepository
            .findById(request.serviceTypeId())
            .filter(type -> type.getRegionId().equals(region.getId()) && type.isEnabled())
            .orElseThrow(
                () ->
                    new BusinessRuleViolationException(
                            "This service type is not available in the pickup's operating area")
                        .withCode("service_type_unavailable"));
    Instant now = clock.instant();
    ScheduledRules.Settings settings = scheduledRideSupport.settings(region);
    if (!settings.bookable(request.scheduledAt(), now)) {
      // UC-R-10 E1 (ruling 2026-10-16): rejected, never silently turned into an on-demand ride.
      throw new BusinessRuleViolationException(
              "A scheduled ride must be at least %d minutes ahead — book now instead"
                  .formatted(settings.minLeadMin()))
          .withCode("scheduled_too_soon")
          .withDetail("minLeadMinutes", settings.minLeadMin());
    }
    // Review H2 (owner ruling 2026-10-17): a gathering shared membership counts as busy.
    rideRepository.lockRider(userId);
    if (sharedRideMemberRepository.existsGatheringMembership(userId)) {
      throw (ConflictException)
          new ConflictException("You already have an active ride").withCode("active_ride_exists");
    }
    // RIDE-S1: the pickup time's surcharge window, NO surge — evaluated at execution.
    BigDecimal surcharge = ridePricing.surchargePercentAt(region, request.scheduledAt());
    BigDecimal surge = SurgeCalculator.NO_SURGE;
    RouteDto route = ridePricing.route(request.pickup(), request.stops(), request.destination());
    EstimateDto estimate =
        ridePricing.estimate(serviceType, region.getCurrency(), route, surcharge, surge);
    Ride ride =
        Ride.builder()
            .riderUserId(userId)
            .regionId(region.getId())
            .serviceTypeId(serviceType.getId())
            .kind(RideKind.SCHEDULED)
            .state(RideState.SCHEDULED)
            .pickup(GeoPoints.point(request.pickup().lat(), request.pickup().lng()))
            .pickupLabel(request.pickup().label())
            .destination(GeoPoints.point(request.destination().lat(), request.destination().lng()))
            .destinationLabel(request.destination().label())
            .stops(rideAssembler.stopMaps(request.stops()))
            .paymentMethod(request.paymentMethod())
            .pickupDistanceMode(preferences(userId).getPickupDistanceMode())
            .currency(region.getCurrency())
            .surgeMultiplier(surge)
            .surchargePercent(surcharge)
            .requestedAt(now)
            .build();
    scheduledRideSupport.applyEstimate(ride, estimate);
    ride = rideRepository.saveAndFlush(ride);
    ScheduledRide scheduled =
        ScheduledRide.builder().rideId(ride.getId()).scheduledAt(request.scheduledAt()).build();
    scheduledRideSupport.skipPastTiers(scheduled, settings, now, false);
    scheduledRideRepository.saveAndFlush(scheduled);
    rideEvents.stateChanged(ride);
    return rideAssembler.view(ride, Audience.RIDER);
  }

  @Override
  @Transactional(readOnly = true)
  public List<RideDto> upcoming(UUID userId) {
    rideAccess.requireRider(userId);
    return rideRepository.findAllById(scheduledRideRepository.findUpcomingOfRider(userId)).stream()
        .map(ride -> rideAssembler.view(ride, Audience.RIDER))
        .sorted(
            (left, right) ->
                left.scheduled().scheduledAt().compareTo(right.scheduled().scheduledAt()))
        .toList();
  }

  @Override
  public void onAccountSuspended(UUID userId, Instant now) {
    cancelScheduledOfRider(userId, now);
    releaseClaimsOfSuspendedDriver(userId, now);
  }

  @Override
  public void cancelScheduledOfRider(UUID userId, Instant now) {
    for (UUID rideId : scheduledRideRepository.findUpcomingOfRider(userId)) {
      Ride ride = rideLifecycle.lock(rideId);
      if (ride.getState() != RideState.SCHEDULED) {
        continue;
      }
      ride.setState(RideState.CANCELLED_BY_RIDER);
      ride.setCancelledAt(now);
      ride.setCancellationReason(CancellationReason.ACCOUNT_SUSPENDED);
      ride.setCancellationFee(null);
      ride = rideRepository.saveAndFlush(ride);
      rideEvents.stateChanged(ride);
      scheduledRideRepository
          .findById(rideId)
          .filter(ScheduledRide::isClaimed)
          .ifPresent(
              scheduled ->
                  rideEvents.push(
                      scheduled.getClaimedDriverUserId(),
                      NotificationEvent.RIDE_CANCELLED_BY_RIDER,
                      Map.of("rideId", rideId.toString())));
    }
  }

  @Override
  public void releaseClaimsOfSuspendedDriver(UUID driverUserId, Instant now) {
    for (UUID rideId : scheduledRideRepository.findPendingClaims(driverUserId)) {
      Ride ride = rideLifecycle.lock(rideId);
      ScheduledRide scheduled = scheduledRideRepository.findById(rideId).orElseThrow();
      if (ride.getState() == RideState.SCHEDULED
          && !scheduled.isExecuted()
          && driverUserId.equals(scheduled.getClaimedDriverUserId())) {
        scheduledRideSupport.release(
            ride, scheduled, ClaimReleaseReason.ACCOUNT_SUSPENDED, null, now);
      }
    }
  }

  private RiderPreference preferences(UUID userId) {
    return riderPreferenceRepository
        .findById(userId)
        .orElseGet(() -> RiderPreference.defaults(userId));
  }
}
