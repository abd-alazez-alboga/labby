package com.labby.backend.service;

import com.labby.backend.dto.RiderPreferencesDto;
import com.labby.backend.model.RiderPreference;
import com.labby.backend.repository.RiderPreferenceRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** One row per rider, created on first save; no row reads as the defaults. */
@Service
@Transactional
@RequiredArgsConstructor
public class RiderPreferenceServiceImpl implements RiderPreferenceService {

  private final RiderPreferenceRepository riderPreferenceRepository;
  private final RideAccess rideAccess;

  @Override
  @Transactional(readOnly = true)
  public RiderPreferencesDto get(UUID userId) {
    rideAccess.requireRider(userId);
    return toDto(
        riderPreferenceRepository
            .findById(userId)
            .orElseGet(() -> RiderPreference.defaults(userId)));
  }

  @Override
  public RiderPreferencesDto replace(UUID userId, RiderPreferencesDto request) {
    rideAccess.requireRider(userId);
    RiderPreference preference =
        riderPreferenceRepository
            .findById(userId)
            .orElseGet(() -> RiderPreference.defaults(userId));
    preference.setTemperature(request.temperature());
    preference.setConversation(request.conversation());
    preference.setMusic(request.music());
    preference.setPickupDistanceMode(request.pickupDistanceMode());
    return toDto(riderPreferenceRepository.save(preference));
  }

  private static RiderPreferencesDto toDto(RiderPreference preference) {
    return new RiderPreferencesDto(
        preference.getTemperature(),
        preference.getConversation(),
        preference.getMusic(),
        preference.getPickupDistanceMode());
  }
}
