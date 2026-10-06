package com.labby.backend.service;

import com.labby.backend.dto.LocationSampleDto;
import java.util.List;
import java.util.UUID;

/**
 * GPS ingestion and stream health (TRK-01, TRK-04). Only each driver's latest position is kept;
 * samples from drivers who are not online are rejected and samples older than the stored fix are
 * ignored (out-of-order delivery).
 */
public interface DriverLocationService {

  /** What happened to one sample. */
  enum Outcome {
    /** Now the driver's current position. */
    STORED,
    /** Older than the stored fix — ignored. */
    IGNORED,
    /** The driver is offline — rejected. */
    NOT_ONLINE,
    /** The account has no driver profile — rejected. */
    NOT_DRIVER
  }

  /**
   * Ingests one already-validated sample.
   *
   * @param userId the sending account
   * @param sample the sample
   * @return the outcome
   */
  Outcome ingest(UUID userId, LocationSampleDto sample);

  /**
   * Ingests a validated batch (REST fallback): the newest sample becomes the current position.
   *
   * @param userId the sending account
   * @param samples one or more samples
   * @throws com.labby.backend.exception.ConflictException when offline or not a driver
   */
  void ingestBatch(UUID userId, List<LocationSampleDto> samples);

  /**
   * Whether an online driver's last sample arrived within the stale window (TRK-04).
   *
   * @param userId the driver
   * @return true when the stream is healthy
   */
  boolean isStreamHealthy(UUID userId);

  /**
   * Online drivers with a healthy stream — the set M7 dispatch may offer rides to (TRK-04: stale
   * drivers are excluded until samples resume).
   *
   * @return the driver account ids
   */
  List<UUID> streamingDriverIds();
}
