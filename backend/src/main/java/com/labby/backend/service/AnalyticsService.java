package com.labby.backend.service;

import com.labby.backend.dto.AnalyticsDashboardDto;
import java.time.Instant;
import java.util.UUID;

/** The admin analytics dashboard (ADM-02, UC-A-30; permission {@code analytics:view}). */
public interface AnalyticsService {

  /** The longest range one dashboard request may span (analytics-v1). */
  int MAX_RANGE_DAYS = 366;

  /**
   * The four ADM-02 groups over {@code [from, to)}, optionally narrowed to one region.
   *
   * @param from inclusive
   * @param to exclusive
   * @param regionId optional region
   * @return the dashboard
   */
  AnalyticsDashboardDto dashboard(Instant from, Instant to, UUID regionId);
}
