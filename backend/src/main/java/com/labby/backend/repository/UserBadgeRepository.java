package com.labby.backend.repository;

import com.labby.backend.model.UserBadge;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Awarded badges (GAME-01), exactly-once by primary key. */
public interface UserBadgeRepository extends JpaRepository<UserBadge, UserBadge.Key> {

  List<UserBadge> findByUserId(UUID userId);

  boolean existsByUserIdAndBadgeCode(UUID userId, String badgeCode);

  /**
   * GAME-01 exactly-once without aborting the caller's transaction (M13 review W2): the race loser
   * gets 0 rows and stands down.
   *
   * @return 1 when the badge was awarded now, 0 when it was already held
   */
  @Modifying
  @Query(
      value =
          "INSERT INTO user_badges (user_id, badge_code) VALUES (:userId, :badgeCode) ON CONFLICT"
              + " (user_id, badge_code) DO NOTHING",
      nativeQuery = true)
  int insertIfAbsent(@Param("userId") UUID userId, @Param("badgeCode") String badgeCode);
}
