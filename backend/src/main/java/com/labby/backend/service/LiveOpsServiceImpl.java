package com.labby.backend.service;

import com.labby.backend.config.CommsProperties;
import com.labby.backend.config.TrackingProperties;
import com.labby.backend.dto.LatLngDto;
import com.labby.backend.dto.LiveOpsDto;
import com.labby.backend.dto.SurgeStateDto;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Ride;
import com.labby.backend.repository.DriverLocationRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.SosEventRepository;
import com.labby.backend.repository.projection.LiveOpsDriverRow;
import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The live ops snapshot (ADM-03, UC-A-19): driver dots from {@code driver_locations} (the realtime
 * staleness window), active rides (requested → in_progress) flagged red when an open SOS exists,
 * the M9 surge state's zone overlay, and the open SOS pins — one poll, no admin WebSocket (demo
 * scale).
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class LiveOpsServiceImpl implements LiveOpsService {

  private final RegionRepository regionRepository;
  private final DriverLocationRepository driverLocationRepository;
  private final RideRepository rideRepository;
  private final SosEventRepository sosEventRepository;
  private final SurgeService surgeService;
  private final SosService sosService;
  private final RideAssembler rideAssembler;
  private final CommsProperties commsProperties;
  private final TrackingProperties trackingProperties;
  private final Clock clock;

  @Override
  public LiveOpsDto snapshot(UUID regionId) {
    if (!regionRepository.existsById(regionId)) {
      throw new ResourceNotFoundException("Region not found");
    }
    Instant now = clock.instant();
    List<Ride> activeRides =
        rideRepository.findByRegionIdAndStateInOrderByRequestedAtAsc(
            regionId, RideRepository.ACTIVE_STATES);
    Set<UUID> sosOpenRideIds =
        activeRides.isEmpty()
            ? Set.of()
            : new HashSet<>(
                sosEventRepository.findOpenRideIds(activeRides.stream().map(Ride::getId).toList()));
    // A driver dot is on_ride when an assigned active ride binds them (the red route's driver).
    Map<UUID, UUID> rideByDriver =
        activeRides.stream()
            .filter(ride -> ride.getDriverUserId() != null)
            .collect(
                Collectors.toMap(Ride::getDriverUserId, Ride::getId, (first, second) -> first));
    List<LiveOpsDto.LiveOpsDriverDto> drivers =
        driverLocationRepository
            .findFreshInRegion(regionId, now.minusSeconds(trackingProperties.staleAfterSeconds()))
            .stream()
            .map(row -> driver(row, rideByDriver))
            .toList();
    SurgeStateDto surge = surgeService.surgeState(regionId);
    return new LiveOpsDto(
        regionId,
        now,
        commsProperties.liveopsRefreshSeconds(),
        drivers,
        activeRides.stream().map(ride -> ride(ride, sosOpenRideIds)).toList(),
        surge.zones().stream()
            .map(
                zone ->
                    new LiveOpsDto.LiveOpsSurgeZoneDto(
                        zone.id(),
                        zone.name(),
                        zone.polygon(),
                        zone.currentMultiplier(),
                        zone.level()))
            .toList(),
        sosService.adminViews(sosEventRepository.findOpenByRegion(regionId)));
  }

  private static LiveOpsDto.LiveOpsDriverDto driver(
      LiveOpsDriverRow row, Map<UUID, UUID> rideByDriver) {
    UUID rideId = rideByDriver.get(row.getDriverUserId());
    return new LiveOpsDto.LiveOpsDriverDto(
        row.getDriverUserId(),
        row.getName(),
        row.getLat(),
        row.getLng(),
        row.getHeadingDeg(),
        rideId == null ? "idle" : "on_ride",
        rideId);
  }

  private LiveOpsDto.LiveOpsRideDto ride(Ride ride, Set<UUID> sosOpenRideIds) {
    return new LiveOpsDto.LiveOpsRideDto(
        ride.getId(),
        ride.getState().getValue(),
        new LatLngDto(ride.getPickup().getY(), ride.getPickup().getX()),
        new LatLngDto(ride.getDestination().getY(), ride.getDestination().getX()),
        rideAssembler.stops(ride.getStops()).stream()
            .map(stop -> new LatLngDto(stop.lat(), stop.lng()))
            .toList(),
        ride.getDriverUserId(),
        sosOpenRideIds.contains(ride.getId()));
  }
}
