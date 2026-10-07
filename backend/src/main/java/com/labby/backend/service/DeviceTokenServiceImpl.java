package com.labby.backend.service;

import com.labby.backend.dto.DeviceRegistrationDto;
import com.labby.backend.repository.DeviceTokenRepository;
import java.time.Clock;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Device tokens backed by {@code device_tokens} (unique token, atomic upsert). */
@Service
@Transactional
@RequiredArgsConstructor
public class DeviceTokenServiceImpl implements DeviceTokenService {

  private final DeviceTokenRepository deviceTokenRepository;
  private final Clock clock;

  @Override
  public void register(UUID userId, DeviceRegistrationDto registration) {
    deviceTokenRepository.upsert(
        userId,
        registration.token(),
        registration.platform().getValue(),
        registration.app().getValue(),
        clock.instant());
  }

  @Override
  public void unregister(UUID userId, String token) {
    deviceTokenRepository.deleteOwned(token, userId);
  }

  @Override
  public void removeAllForUser(UUID userId) {
    deviceTokenRepository.deleteByUserId(userId);
  }
}
