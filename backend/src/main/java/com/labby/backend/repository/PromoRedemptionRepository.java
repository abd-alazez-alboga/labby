package com.labby.backend.repository;

import com.labby.backend.model.PromoRedemption;
import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Promo redemptions (GRW-02): one per ride ever (V24). A row exists from the booking reservation
 * on; rides that end without completing delete theirs, releasing the caps.
 */
public interface PromoRedemptionRepository extends JpaRepository<PromoRedemption, UUID> {

  Optional<PromoRedemption> findByRideId(UUID rideId);

  long countByPromoId(UUID promoId);

  long countByPromoIdAndUserId(UUID promoId, UUID userId);

  Page<PromoRedemption> findByPromoIdOrderByCreatedAtDesc(UUID promoId, Pageable pageable);

  void deleteByRideId(UUID rideId);

  /**
   * How many redemptions count against the promo's total cap: every reservation whose ride is not
   * terminally dead (a cancelled or failed ride releases its reservation by not counting; the row
   * stays as the audit trail).
   */
  @Query(
      value =
          """
          SELECT COUNT(*) FROM promo_redemptions pr JOIN rides r ON r.ride_id = pr.ride_id
          WHERE pr.promo_id = :promoId
            AND r.state NOT IN ('cancelled_by_rider', 'cancelled_by_driver', 'no_driver_found')
          """,
      nativeQuery = true)
  long countingAgainstCap(@Param("promoId") UUID promoId);

  /** As {@link #countingAgainstCap}, for one user's per-user limit. */
  @Query(
      value =
          """
          SELECT COUNT(*) FROM promo_redemptions pr JOIN rides r ON r.ride_id = pr.ride_id
          WHERE pr.promo_id = :promoId AND pr.user_id = :userId
            AND r.state NOT IN ('cancelled_by_rider', 'cancelled_by_driver', 'no_driver_found')
          """,
      nativeQuery = true)
  long countingAgainstUserLimit(@Param("promoId") UUID promoId, @Param("userId") UUID userId);

  /** The applied total of one promo's redemptions (admin monitoring; single-currency promos). */
  @Query("SELECT COALESCE(SUM(r.amount), 0) FROM PromoRedemption r WHERE r.promoId = :promoId")
  BigDecimal redeemedAmount(@Param("promoId") UUID promoId);
}
