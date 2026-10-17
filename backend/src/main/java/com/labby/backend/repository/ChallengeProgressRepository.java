package com.labby.backend.repository;

import com.labby.backend.model.ChallengeProgress;
import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Per-participant challenge progress (GAME-02). Writers go through {@link #lockOrCreate}. */
public interface ChallengeProgressRepository
    extends JpaRepository<ChallengeProgress, ChallengeProgress.Key> {

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query(
      "SELECT p FROM ChallengeProgress p WHERE p.challengeId = :challengeId AND p.userId ="
          + " :userId")
  Optional<ChallengeProgress> findForUpdate(
      @Param("challengeId") UUID challengeId, @Param("userId") UUID userId);

  /** Insert-if-absent so a racing first event never hits a primary-key clash. */
  @Modifying
  @Query(
      value =
          "INSERT INTO challenge_progress (challenge_id, user_id) VALUES (:challengeId, :userId)"
              + " ON CONFLICT (challenge_id, user_id) DO NOTHING",
      nativeQuery = true)
  void insertIfAbsent(@Param("challengeId") UUID challengeId, @Param("userId") UUID userId);

  /** Insert-if-absent, then lock. */
  default ChallengeProgress lockOrCreate(UUID challengeId, UUID userId) {
    insertIfAbsent(challengeId, userId);
    return findForUpdate(challengeId, userId).orElseThrow();
  }

  List<ChallengeProgress> findByUserIdAndChallengeIdIn(UUID userId, Collection<UUID> challengeIds);

  Page<ChallengeProgress> findByChallengeIdOrderByProgressDescUpdatedAtAsc(
      UUID challengeId, Pageable pageable);

  long countByChallengeId(UUID challengeId);

  long countByChallengeIdAndCompletedAtIsNotNull(UUID challengeId);
}
