package com.labby.backend.repository;

import com.labby.backend.enums.RideParty;
import com.labby.backend.model.Challenge;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Admin-created challenges (GAME-02). */
public interface ChallengeRepository extends JpaRepository<Challenge, UUID> {

  /** The admin list, newest first, optionally per region. */
  @Query(
      """
      SELECT c FROM Challenge c
      WHERE (:regionId IS NULL OR c.regionId = :regionId)
      ORDER BY c.createdAt DESC
      """)
  Page<Challenge> adminList(@Param("regionId") UUID regionId, Pageable pageable);

  /** A user's view: the region + role's challenges not ended longer than {@code endedSince}. */
  @Query(
      """
      SELECT c FROM Challenge c
      WHERE c.regionId = :regionId AND c.role = :role
        AND c.endsAt > :endedSince AND (c.endedAt IS NULL OR c.endedAt > :endedSince)
      ORDER BY c.startsAt
      """)
  List<Challenge> userList(
      @Param("regionId") UUID regionId,
      @Param("role") RideParty role,
      @Param("endedSince") Instant endedSince);

  /** The challenges counting an event: running at the moment, for the region and role. */
  @Query(
      """
      SELECT c FROM Challenge c
      WHERE c.regionId = :regionId AND c.role = :role AND c.endedAt IS NULL
        AND c.startsAt <= :at AND c.endsAt > :at
      """)
  List<Challenge> runningAt(
      @Param("regionId") UUID regionId, @Param("role") RideParty role, @Param("at") Instant at);
}
