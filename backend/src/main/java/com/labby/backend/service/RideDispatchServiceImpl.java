package com.labby.backend.service;

import com.labby.backend.config.RideProperties;
import com.labby.backend.config.TrackingProperties;
import com.labby.backend.dto.LatLngDto;
import com.labby.backend.dto.RouteDto;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.OfferResponse;
import com.labby.backend.enums.PickupDistanceMode;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RideOffer;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideOfferRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RideRepository.DispatchCandidate;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Candidates (rides-v1 Dispatch): the nearest eligible drivers by straight line — the SQL applies
 * every gate (role/account active, approved, online, fresh stream, vehicle with the service type,
 * no open offer, no assigned ride, never offered this ride, {@code nearby_only} radius = the
 * region's pickup-fee threshold) — then the duty gates (M8 balance floor seam), then ranked by
 * routed pickup ETA. Drivers who cancelled an earlier ride of a re-dispatch chain are excluded.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RideDispatchServiceImpl implements RideDispatchService {

  private static final int BATCH = 50;

  private final RideRepository rideRepository;
  private final RideOfferRepository rideOfferRepository;
  private final RegionRepository regionRepository;
  private final RoutingProvider routingProvider;
  private final DriverDutyGates driverDutyGates;
  private final RideEvents rideEvents;
  private final RideProperties rideProperties;
  private final TrackingProperties trackingProperties;
  private final TransactionTemplate transactionTemplate;
  private final Clock clock;

  @Override
  public int dispatchDue() {
    Instant now = clock.instant();
    List<UUID> due =
        rideRepository.findDispatchDue(now, now.minus(rideProperties.giveUpAfter()), BATCH);
    int advanced = 0;
    for (UUID rideId : due) {
      try {
        if (advance(rideId)) {
          advanced++;
        }
      } catch (RuntimeException ex) {
        // E.g. the chosen driver got another ride's offer on another instance at the same moment
        // (unique open offer per driver): the step rolled back; the next tick retries.
        log.debug(
            "Dispatch step for ride {} rolled back: {}", rideId, ex.getClass().getSimpleName());
      }
    }
    return advanced;
  }

  @Override
  public boolean advance(UUID rideId) {
    return Boolean.TRUE.equals(transactionTemplate.execute(status -> step(rideId)));
  }

  private boolean step(UUID rideId) {
    Optional<Ride> locked = rideRepository.lockIfFree(rideId);
    if (locked.isEmpty()) {
      return false;
    }
    Ride ride = locked.get();
    if (ride.getState() != RideState.REQUESTED && ride.getState() != RideState.OFFERING) {
      return false;
    }
    Instant now = clock.instant();
    boolean givingUp = !ride.getRequestedAt().plus(rideProperties.giveUpAfter()).isAfter(now);
    Optional<RideOffer> open = rideOfferRepository.findFirstByRideIdAndResponseIsNull(rideId);
    if (open.isPresent()) {
      RideOffer offer = open.get();
      if (now.isBefore(offer.getExpiresAt()) && !givingUp) {
        return false;
      }
      boolean expired = !now.isBefore(offer.getExpiresAt());
      offer.setResponse(expired ? OfferResponse.TIMEOUT : OfferResponse.WITHDRAWN);
      offer.setRespondedAt(now);
      rideOfferRepository.saveAndFlush(offer);
      rideEvents.offerWithdrawn(offer, expired ? "timeout" : "ride_ended");
    }
    if (givingUp) {
      noDriverFound(ride, now);
      return true;
    }
    Optional<Pick> pick = pickCandidate(ride, now);
    if (pick.isEmpty()) {
      noDriverFound(ride, now);
      return true;
    }
    RideOffer offer =
        rideOfferRepository.saveAndFlush(
            RideOffer.builder()
                .rideId(ride.getId())
                .driverUserId(pick.get().candidate().getDriverUserId())
                .vehicleId(pick.get().candidate().getVehicleId())
                .sequence((short) (rideOfferRepository.countByRideId(ride.getId()) + 1))
                .pickupDistanceM((int) pick.get().route().distanceMeters())
                .pickupEtaS((int) pick.get().route().durationSeconds())
                .offeredAt(now)
                .expiresAt(now.plus(rideProperties.offerWindow()))
                .build());
    boolean firstOffer = ride.getState() == RideState.REQUESTED;
    if (firstOffer) {
      ride.setState(RideState.OFFERING);
      ride.setOfferingAt(now);
      ride = rideRepository.saveAndFlush(ride);
      rideEvents.stateChanged(ride);
    }
    rideEvents.offerOpened(ride, offer);
    return true;
  }

  private Optional<Pick> pickCandidate(Ride ride, Instant now) {
    Region region = regionRepository.findById(ride.getRegionId()).orElseThrow();
    Double maxDistance =
        ride.getPickupDistanceMode() == PickupDistanceMode.NEARBY_ONLY
                && region.getPickupFeeThresholdKm() != null
            ? region.getPickupFeeThresholdKm().multiply(BigDecimal.valueOf(1000)).doubleValue()
            : null;
    List<DispatchCandidate> pool =
        rideRepository.findDispatchCandidates(
            ride.getId(),
            now.minusSeconds(trackingProperties.staleAfterSeconds()),
            uuidArray(excludedDrivers(ride)),
            maxDistance,
            rideProperties.candidatePoolSize());
    LatLngDto pickup = new LatLngDto(ride.getPickup().getY(), ride.getPickup().getX());
    List<Pick> picks = new ArrayList<>();
    for (DispatchCandidate candidate : pool) {
      if (driverDutyGates.offersBlockedReason(candidate.getDriverUserId(), ride.getRegionId())
          != null) {
        continue;
      }
      RouteDto route =
          routingProvider.route(
              List.of(new LatLngDto(candidate.getLat(), candidate.getLng()), pickup));
      picks.add(new Pick(candidate, route));
    }
    return picks.stream()
        .min(
            Comparator.comparingLong((Pick pick) -> pick.route().durationSeconds())
                .thenComparingDouble(pick -> pick.candidate().getDistanceMeters()));
  }

  /** Drivers who cancelled an earlier ride of this ride's re-dispatch chain (owner 2026-10-07). */
  private Set<UUID> excludedDrivers(Ride ride) {
    Set<UUID> excluded = new LinkedHashSet<>();
    UUID previousId = ride.getRedispatchOfRideId();
    while (previousId != null && excluded.size() < 50) {
      Optional<Ride> previous = rideRepository.findById(previousId);
      if (previous.isEmpty()) {
        break;
      }
      if (previous.get().getDriverUserId() != null) {
        excluded.add(previous.get().getDriverUserId());
      }
      previousId = previous.get().getRedispatchOfRideId();
    }
    return excluded;
  }

  private void noDriverFound(Ride ride, Instant now) {
    ride.setState(RideState.NO_DRIVER_FOUND);
    ride.setNoDriverFoundAt(now);
    ride = rideRepository.saveAndFlush(ride);
    rideEvents.stateChanged(ride);
    // RIDE-S4: a scheduled ride's fallback failure tells the rider to replan (its own text).
    rideEvents.push(
        ride.getRiderUserId(),
        NotificationEvent.RIDE_NO_DRIVER_FOUND,
        Map.of(
            "rideId",
            ride.getId().toString(),
            "scheduled",
            String.valueOf(ride.getKind() == RideKind.SCHEDULED)));
  }

  private static String uuidArray(Set<UUID> ids) {
    return ids.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
  }

  private record Pick(DispatchCandidate candidate, RouteDto route) {}
}
