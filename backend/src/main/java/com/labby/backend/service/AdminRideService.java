package com.labby.backend.service;

import com.labby.backend.dto.AdminRideDetailDto;
import com.labby.backend.dto.AdminRideSummaryPageDto;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import java.time.Instant;
import java.util.UUID;

/** Admin ride search and inspection (UC-A-18, ADM-05; permission {@code rides:view}). */
public interface AdminRideService {

  /** Search filters; every one optional. {@code userId}/{@code phone} match rider OR driver. */
  record Filter(
      UUID regionId,
      RideState state,
      RideKind kind,
      UUID userId,
      String phone,
      Instant from,
      Instant to) {}

  /**
   * Searches rides, newest first.
   *
   * @param filter the filters
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  AdminRideSummaryPageDto search(Filter filter, int page, int size);

  /**
   * The full truth of one ride: timeline, trace, offers trail, fare.
   *
   * @param rideId the ride
   * @return the detail
   */
  AdminRideDetailDto detail(UUID rideId);
}
