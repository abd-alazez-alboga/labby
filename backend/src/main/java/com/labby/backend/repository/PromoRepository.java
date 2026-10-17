package com.labby.backend.repository;

import com.labby.backend.model.Promo;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Promo codes (GRW-01/02). Cap counting happens under {@link #lockById}. */
public interface PromoRepository extends JpaRepository<Promo, UUID> {

  Optional<Promo> findByCode(String code);

  boolean existsByCode(String code);

  /** The booking-time reservation lock: caps are counted while this row is held. */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT p FROM Promo p WHERE p.id = :promoId")
  Optional<Promo> lockById(@Param("promoId") UUID promoId);

  /** The admin list, newest first, with optional region and active filters. */
  @Query(
      """
      SELECT p FROM Promo p
      WHERE (:regionId IS NULL OR p.regionId = :regionId)
        AND (:active IS NULL OR p.active = :active)
      ORDER BY p.createdAt DESC
      """)
  Page<Promo> adminList(
      @Param("regionId") UUID regionId, @Param("active") Boolean active, Pageable pageable);
}
