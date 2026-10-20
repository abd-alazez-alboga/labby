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
import java.time.Duration;
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
 * destination after, through the stops the trace has not passed yet (V1 audit W40).
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

  /** V1 audit W40: the slip that triggers a delay notice, and the minimum gap between two. */
  static final Duration ETA_DELAY_NOTICE = Duration.ofMinutes(5);

  /** V1 audit W40: an in-ride sample this close to a stop marks it visited. */
  static final double STOP_VISITED_METERS = 150;

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
      boolean inRide = ride.getState() == RideState.IN_PROGRESS;
      List<LatLngDto> points = new ArrayList<>();
      points.add(from);
      if (inRide) {
        // V1 audit W40: during the trip the ETA routes through the stops not yet visited.
        points.addAll(remainingStops(ride));
        points.add(new LatLngDto(ride.getDestination().getY(), ride.getDestination().getX()));
      } else {
        points.add(new LatLngDto(ride.getPickup().getY(), ride.getPickup().getX()));
      }
      ride.setEtaSeconds((int) routingProvider.route(points).durationSeconds());
      ride.setEtaRefreshedAt(now);
      notifyEtaDelay(ride, now, inRide);
      changed = true;
    }
    if (changed) {
      rideRepository.saveAndFlush(ride);
    }
    return changed;
  }

  /**
   * The stops after the last one the in-ride trace passed within {@link #STOP_VISITED_METERS} (the
   * stop order is the booked order), as routing points.
   */
  private List<LatLngDto> remainingStops(Ride ride) {
    List<LatLngDto> stops = new ArrayList<>();
    for (Map<String, Object> stop : ride.getStops()) {
      stops.add(
          new LatLngDto(
              ((Number) stop.get("lat")).doubleValue(), ((Number) stop.get("lng")).doubleValue()));
    }
    int lastVisited = -1;
    for (int i = 0; i < stops.size(); i++) {
      if (rideTraceRepository.passedNear(
          ride.getId(), stops.get(i).lat(), stops.get(i).lng(), STOP_VISITED_METERS)) {
        lastVisited = i;
      }
    }
    return stops.subList(lastVisited + 1, stops.size());
  }

  /**
   * V1 audit W40 (owner ruling 2026-10-20): the rider is told when the expected arrival (refresh +
   * ETA) slips by {@link #ETA_DELAY_NOTICE} or more over the last one they were told of in this
   * phase, at most once per {@link #ETA_DELAY_NOTICE}. The first ETA of a phase is the baseline.
   */
  private void notifyEtaDelay(Ride ride, Instant now, boolean inRide) {
    Instant arrival = now.plusSeconds(ride.getEtaSeconds());
    Instant baseline = ride.getEtaBaselineArrivalAt();
    if (baseline == null) {
      ride.setEtaBaselineArrivalAt(arrival);
      return;
    }
    boolean slipped = !arrival.isBefore(baseline.plus(ETA_DELAY_NOTICE));
    boolean rested =
        ride.getEtaDelayNotifiedAt() == null
            || !now.isBefore(ride.getEtaDelayNotifiedAt().plus(ETA_DELAY_NOTICE));
    if (!slipped || !rested) {
      return;
    }
    ride.setEtaBaselineArrivalAt(arrival);
    ride.setEtaDelayNotifiedAt(now);
    rideEvents.pushRiders(
        ride,
        NotificationEvent.RIDE_ETA_DELAYED,
        Map.of(
            "rideId", ride.getId().toString(),
            "etaMinutes", String.valueOf(Math.max(1, (ride.getEtaSeconds() + 59) / 60)),
            "phase", inRide ? "destination" : "pickup"));
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
    BigDecimal rate = rideExtrasCalculator.waitPerMinRate(ride, region);
    if (rate.signum() <= 0
        || now.isBefore(rideExtrasCalculator.waitChargeStartsAt(ride, region))
        || notificationOutboxRepository.existsByEventAndRideId(
            NotificationEvent.RIDE_WAIT_CHARGE_STARTED.getValue(), ride.getId().toString())) {
      return;
    }
    rideEvents.pushRiders(
        ride,
        NotificationEvent.RIDE_WAIT_CHARGE_STARTED,
        Map.of(
            "rideId", ride.getId().toString(),
            "rate", rate.toPlainString(),
            "currency", ride.getCurrency()));
  }
}
