package com.labby.backend.service;

import com.labby.backend.dto.AdminRideDetailDto;
import com.labby.backend.dto.AdminRideSummaryDto;
import com.labby.backend.dto.AdminRideSummaryPageDto;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import java.time.Instant;
import java.util.List;
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
   * Every ride of the filter in search order — the rides CSV export (ADM-06): at most {@code
   * maxRows}, 422 {@code export_too_large} above.
   *
   * @param filter the filters
   * @param maxRows the export cap
   * @return the rows
   */
  List<AdminRideSummaryDto> searchAll(Filter filter, int maxRows);

  /**
   * The full truth of one ride: timeline, trace, offers trail, fare.
   *
   * @param rideId the ride
   * @return the detail
   */
  AdminRideDetailDto detail(UUID rideId);
}
