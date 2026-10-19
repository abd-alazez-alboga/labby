package com.labby.backend.dto;

import com.labby.backend.enums.ApplicationStatus;
import java.time.Instant;
import java.util.UUID;

/**
 * A drivers-list row (analytics-v1 {@code AdminDriver}). The region and plate are the active
 * vehicle's; {@code phone} is contact access (UC-A-20), null without {@code support:handle}.
 */
public record AdminDriverDto(
    UUID userId,
    String name,
    String phone,
    ApplicationStatus applicationStatus,
    boolean online,
    UUID regionId,
    String regionName,
    String vehiclePlate,
    Instant createdAt) {

  /**
   * This row without the phone (no contact access).
   *
   * @return the copy
   */
  public AdminDriverDto withoutPhone() {
    return new AdminDriverDto(
        userId,
        name,
        null,
        applicationStatus,
        online,
        regionId,
        regionName,
        vehiclePlate,
        createdAt);
  }
}
