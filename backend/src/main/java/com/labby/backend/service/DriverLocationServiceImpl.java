package com.labby.backend.service;

import com.labby.backend.config.TrackingProperties;
import com.labby.backend.dto.LocationSampleDto;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.repository.DriverLocationRepository;
import com.labby.backend.repository.DriverProfileRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writes the latest position with one upsert per sample (NFR-P3: two indexed statements per sample,
 * no read-modify-write); a driver on an assigned ride also gets the sample traced and relayed (M7,
 * {@link RideTrackingService}). Device time later than server time is clamped (M6 owner item b).
 * {@code received_at} is the server clock — stale detection never trusts device time.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverLocationServiceImpl implements DriverLocationService {

  private final DriverProfileRepository driverProfileRepository;
  private final DriverLocationRepository driverLocationRepository;
  private final RideTrackingService rideTrackingService;
  private final TrackingProperties trackingProperties;
  private final Clock clock;

  @Override
  public Outcome ingest(UUID userId, LocationSampleDto sample) {
    LocationSampleDto clamped = clamp(sample);
    Outcome outcome = store(userId, clamped);
    if (outcome == Outcome.STORED || outcome == Outcome.IGNORED) {
      // An out-of-order sample is still a real point of the ride's trace (TRK-03).
      rideTrackingService.record(userId, List.of(clamped));
    }
    return outcome;
  }

  private Outcome store(UUID userId, LocationSampleDto sample) {
    Optional<Boolean> online = driverProfileRepository.findOnlineByUserId(userId);
    if (online.isEmpty()) {
      return Outcome.NOT_DRIVER;
    }
    if (!online.get()) {
      return Outcome.NOT_ONLINE;
    }
    int stored =
        driverLocationRepository.upsertIfNewer(
            userId,
            sample.lat(),
            sample.lng(),
            sample.headingDeg(),
            sample.speedMps(),
            sample.accuracyM(),
            sample.recordedAt(),
            clock.instant());
    return stored > 0 ? Outcome.STORED : Outcome.IGNORED;
  }

  @Override
  public void ingestBatch(UUID userId, List<LocationSampleDto> samples) {
    List<LocationSampleDto> clamped = samples.stream().map(this::clamp).toList();
    LocationSampleDto newest =
        clamped.stream().max(Comparator.comparing(LocationSampleDto::recordedAt)).orElseThrow();
    Outcome outcome = store(userId, newest);
    if (outcome == Outcome.STORED || outcome == Outcome.IGNORED) {
      // A reconnect batch fills the ride trace's gap with every sample, not just the newest.
      rideTrackingService.record(userId, clamped);
    }
    switch (outcome) {
      case NOT_DRIVER -> throw new ConflictException("This account is not a driver");
      case NOT_ONLINE -> throw new ConflictException("You are offline");
      default -> {
        // Stored, or ignored as older than the current fix: both are accepted.
      }
    }
  }

  @Override
  @Transactional(readOnly = true)
  public boolean isStreamHealthy(UUID userId) {
    return driverLocationRepository.isStreaming(userId, cutoff());
  }

  @Override
  @Transactional(readOnly = true)
  public List<UUID> streamingDriverIds() {
    return driverLocationRepository.findStreamingDriverIds(cutoff());
  }

  /**
   * A device clock ahead of the server must not pin a future position (M6 owner item b): {@code
   * recordedAt} later than server time is clamped to it.
   */
  private LocationSampleDto clamp(LocationSampleDto sample) {
    Instant now = clock.instant();
    if (!sample.recordedAt().isAfter(now)) {
      return sample;
    }
    return new LocationSampleDto(
        sample.lat(),
        sample.lng(),
        sample.headingDeg(),
        sample.speedMps(),
        sample.accuracyM(),
        now);
  }

  private Instant cutoff() {
    return clock.instant().minusSeconds(trackingProperties.staleAfterSeconds());
  }
}
