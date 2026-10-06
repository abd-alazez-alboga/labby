package com.labby.backend.repository;

import com.labby.backend.model.DeviceToken;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** FCM registration tokens (ES-03). */
public interface DeviceTokenRepository extends JpaRepository<DeviceToken, UUID> {

  Optional<DeviceToken> findByToken(String token);

  List<DeviceToken> findByUserId(UUID userId);
}
