package com.labby.backend.service;

import com.labby.backend.dto.RiderPreferencesDto;
import java.util.UUID;

/** Rider comfort preferences + matching toggle (UC-R-02, UC-R-03). */
public interface RiderPreferenceService {

  /**
   * The rider's preferences (defaults when never set).
   *
   * @param userId the rider
   * @return the preferences
   */
  RiderPreferencesDto get(UUID userId);

  /**
   * Replaces the rider's preferences; later bookings and offers use them.
   *
   * @param userId the rider
   * @param request the new values
   * @return the saved preferences
   */
  RiderPreferencesDto replace(UUID userId, RiderPreferencesDto request);
}
