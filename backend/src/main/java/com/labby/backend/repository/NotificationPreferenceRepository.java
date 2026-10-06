package com.labby.backend.repository;

import com.labby.backend.model.NotificationPreference;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Per-category push preferences (NTF-02). */
public interface NotificationPreferenceRepository
    extends JpaRepository<NotificationPreference, NotificationPreference.Key> {

  List<NotificationPreference> findByUserId(UUID userId);
}
