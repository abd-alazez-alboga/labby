package com.labby.backend.service;

import com.labby.backend.dto.AdminRideRelatedDto;
import java.util.UUID;

/**
 * The ride detail's "Related" section (review V1 W15, UC-A-18): reports, support tickets, lost-item
 * cases and SOS events of one ride. The caller says which sections its permissions allow; the
 * others are left out.
 */
public interface AdminRideRelatedService {

  /**
   * What else is filed about a ride.
   *
   * @param rideId the ride
   * @param withReports include the reports ({@code reports:view})
   * @param withSupport include tickets, lost-item cases and SOS events ({@code support:view})
   * @return the sections; 404 for an unknown ride
   */
  AdminRideRelatedDto related(UUID rideId, boolean withReports, boolean withSupport);
}
