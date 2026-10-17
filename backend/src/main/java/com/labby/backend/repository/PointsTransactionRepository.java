package com.labby.backend.repository;

import com.labby.backend.enums.PointsTransactionType;
import com.labby.backend.model.PointsTransaction;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Typed points movements (GRW-04, GAME-02). */
public interface PointsTransactionRepository extends JpaRepository<PointsTransaction, UUID> {

  Page<PointsTransaction> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

  /** The user's points of one type (driver levels count challenge points, GAME-03). */
  @Query(
      "SELECT COALESCE(SUM(t.points), 0) FROM PointsTransaction t WHERE t.userId = :userId AND"
          + " t.type = :type")
  long sumByType(@Param("userId") UUID userId, @Param("type") PointsTransactionType type);
}
