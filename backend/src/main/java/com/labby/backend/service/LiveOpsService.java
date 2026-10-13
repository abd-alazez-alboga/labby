package com.labby.backend.service;

import com.labby.backend.dto.LiveOpsDto;
import java.util.UUID;

/** The admin live ops map feed (ADM-03, UC-A-19): one polled snapshot per region. */
public interface LiveOpsService {

  /**
   * One snapshot: fresh online drivers (idle vs on-ride), active rides with their SOS flag, the M9
   * surge overlay, and the open SOS pins.
   *
   * @param regionId the region
   * @return the snapshot
   * @throws com.labby.backend.exception.ResourceNotFoundException unknown region
   */
  LiveOpsDto snapshot(UUID regionId);
}
