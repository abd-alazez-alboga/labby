package com.labby.backend.service;

import com.labby.backend.repository.RefreshTokenRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** Backs the auth filter's revocation check with the refresh-token store. */
@Service
@RequiredArgsConstructor
public class SessionServiceImpl implements SessionService {

  private final RefreshTokenRepository refreshTokenRepository;

  @Override
  public boolean isSessionLive(UUID sessionId) {
    return refreshTokenRepository.existsByIdAndRevokedAtIsNull(sessionId);
  }
}
