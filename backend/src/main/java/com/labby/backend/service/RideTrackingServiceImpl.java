package com.labby.backend.service;

import com.labby.backend.config.RideProperties;
import com.labby.backend.config.TrackingProperties;
import com.labby.backend.dto.LatLngDto;
import com.labby.backend.dto.LocationSampleDto;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.TracePhase;
import com.labby.backend.model.DriverLocation;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.repository.DriverLocationRepository;
import com.labby.backend.repository.NotificationOutboxRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RideTraceRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Tracing joins the location-ingestion transaction (one extra indexed lookup + one insert per
 * sample). The monitor locks each assigned ride with SKIP LOCKED in its own transaction so several
 * instances can run it (NFR-P4). The ETA targets the pickup until the ride starts and the
 * destination after (the remaining-stop order is not tracked in V1).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RideTrackingServiceImpl implements RideTrackingService {

  private final RideRepository rideRepository;
  private final RideTraceRepository rideTraceRepository;
  private final DriverLocationRepository driverLocationRepository;
  private final RegionRepository regionRepository;
  private final NotificationOutboxRepository notificationOutboxRepository;
  private final RideExtrasCalculator rideExtrasCalculator;
  private final TrackingProperties trackingProperties;
  private final RoutingProvider routingProvider;
  private final RideEvents rideEvents;
  private final RideProperties rideProperties;
  private final TransactionTemplate transactionTemplate;
  private final Clock clock;

  @Override
  @Transactional(propagation = Propagation.MANDATORY)
  public void record(UUID driverUserId, List<LocationSampleDto> samples) {
    Optional<Ride> assigned =
        rideRepository.findFirstByDriverUserIdAndStateIn(
            driverUserId, RideRepository.ASSIGNED_STATES);
    if (assigned.isEmpty() || samples.isEmpty()) {
      return;
    }
    Ride ride = assigned.get();
    Instant now = clock.instant();
    for (LocationSampleDto sample : samples) {
      boolean inRide =
          ride.getStartedAt() != null && !sample.recordedAt().isBefore(ride.getStartedAt());
      rideTraceRepository.append(
          ride.getId(),
          (inRide ? TracePhase.IN_RIDE : TracePhase.TO_PICKUP).getValue(),
          sample.lat(),
          sample.lng(),
          sample.accuracyM(),
          sample.speedMps(),
          sample.headingDeg(),
          sample.recordedAt(),
          now);
    }
    LocationSampleDto newest =
        samples.stream().max(Comparator.comparing(LocationSampleDto::recordedAt)).orElseThrow();
    rideEvents.driverPosition(
        ride, newest.lat(), newest.lng(), newest.headingDeg(), newest.recordedAt());
  }

  @Override
  public int monitor() {
    int changed = 0;
    List<UUID> rideIds = new ArrayList<>();
    rideRepository
        .findByStateIn(RideRepository.ASSIGNED_STATES)
        .forEach(r -> rideIds.add(r.getId()));
    for (UUID rideId : rideIds) {
      try {
        if (Boolean.TRUE.equals(transactionTemplate.execute(status -> check(rideId)))) {
          changed++;
        }
      } catch (RuntimeException ex) {
        log.warn("Ride monitor failed for {}: {}", rideId, ex.getClass().getSimpleName());
      }
    }
    return changed;
  }

  private boolean check(UUID rideId) {
    Optional<Ride> locked = rideRepository.lockIfFree(rideId);
    if (locked.isEmpty() || !locked.get().isAssigned()) {
      return false;
    }
    Ride ride = locked.get();
    Instant now = clock.instant();
    boolean changed = false;
    boolean healthy =
        driverLocationRepository.isStreaming(
            ride.getDriverUserId(), now.minusSeconds(trackingProperties.staleAfterSeconds()));
    if (!healthy && ride.getDriverStreamLostAt() == null) {
      ride.setDriverStreamLostAt(now);
      rideEvents.connection(ride, true);
      changed = true;
    } else if (healthy && ride.getDriverStreamLostAt() != null) {
      ride.setDriverStreamLostAt(null);
      rideEvents.connection(ride, false);
      changed = true;
    }
    notifyWaitChargeStart(ride, now);
    boolean etaDue =
        ride.getEtaRefreshedAt() == null
            || !ride.getEtaRefreshedAt()
                .plusSeconds(rideProperties.etaRefreshSeconds())
                .isAfter(now);
    Optional<DriverLocation> position = driverLocationRepository.findById(ride.getDriverUserId());
    if (etaDue && position.isPresent()) {
      LatLngDto from =
          new LatLngDto(position.get().getPosition().getY(), position.get().getPosition().getX());
      var target =
          ride.getState() == RideState.IN_PROGRESS ? ride.getDestination() : ride.getPickup();
      ride.setEtaSeconds(
          (int) routingProvider.etaSeconds(from, new LatLngDto(target.getY(), target.getX())));
      ride.setEtaRefreshedAt(now);
      changed = true;
    }
    if (changed) {
      rideRepository.saveAndFlush(ride);
    }
    return changed;
  }

  /**
   * PRC-03: tells the rider ONCE when wait-charge accrual starts (the region's wait grace after
   * Arrived ran out while the trip has not started). The outbox is the once-only guard — it keeps
   * delivered rows, so the notice survives restarts and concurrent monitor instances.
   */
  private void notifyWaitChargeStart(Ride ride, Instant now) {
    if (ride.getState() != RideState.DRIVER_ARRIVED) {
      return;
    }
    Region region = regionRepository.findById(ride.getRegionId()).orElseThrow();
    BigDecimal rate = rideExtrasCalculator.waitPerMinRate(region);
    if (rate.signum() <= 0
        || now.isBefore(rideExtrasCalculator.waitChargeStartsAt(ride, region))
        || notificationOutboxRepository.existsByEventAndRideId(
            NotificationEvent.RIDE_WAIT_CHARGE_STARTED.getValue(), ride.getId().toString())) {
      return;
    }
    rideEvents.push(
        ride.getRiderUserId(),
        NotificationEvent.RIDE_WAIT_CHARGE_STARTED,
        Map.of(
            "rideId", ride.getId().toString(),
            "rate", rate.toPlainString(),
            "currency", ride.getCurrency()));
  }
}
