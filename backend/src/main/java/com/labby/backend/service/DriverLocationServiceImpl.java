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
 * no read-modify-write). {@code received_at} is the server clock — stale detection never trusts
 * device time.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverLocationServiceImpl implements DriverLocationService {

  private final DriverProfileRepository driverProfileRepository;
  private final DriverLocationRepository driverLocationRepository;
  private final TrackingProperties trackingProperties;
  private final Clock clock;

  @Override
  public Outcome ingest(UUID userId, LocationSampleDto sample) {
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
    LocationSampleDto newest =
        samples.stream().max(Comparator.comparing(LocationSampleDto::recordedAt)).orElseThrow();
    switch (ingest(userId, newest)) {
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

  private Instant cutoff() {
    return clock.instant().minusSeconds(trackingProperties.staleAfterSeconds());
  }
}
