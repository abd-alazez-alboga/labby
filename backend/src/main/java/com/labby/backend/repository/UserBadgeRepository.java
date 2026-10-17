package com.labby.backend.repository;

import com.labby.backend.model.UserBadge;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Awarded badges (GAME-01), exactly-once by primary key. */
public interface UserBadgeRepository extends JpaRepository<UserBadge, UserBadge.Key> {

  List<UserBadge> findByUserId(UUID userId);

  boolean existsByUserIdAndBadgeCode(UUID userId, String badgeCode);
}
