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
 * on; a ride that ends without completing keeps its row as the audit trail but stops counting
 * against the caps (live-ride counting below); a shared-ride member who leaves releases their own
 * row so another member may apply a promo on the same ride (M13 review H1).
 */
public interface PromoRedemptionRepository extends JpaRepository<PromoRedemption, UUID> {

  Optional<PromoRedemption> findByRideId(UUID rideId);

  Page<PromoRedemption> findByPromoIdOrderByCreatedAtDesc(UUID promoId, Pageable pageable);

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

  /**
   * The applied total of one promo's redemptions: completed rides only — reservations on live rides
   * still carry the booking estimate (admin monitoring; single-currency promos).
   */
  @Query(
      value =
          """
          SELECT COALESCE(SUM(pr.amount), 0) FROM promo_redemptions pr
          JOIN rides r ON r.ride_id = pr.ride_id
          WHERE pr.promo_id = :promoId AND r.state = 'completed'
          """,
      nativeQuery = true)
  BigDecimal appliedAmount(@Param("promoId") UUID promoId);

  /**
   * The user's alive reservations on first-ride-only promos (M13 review W1: one first-ride promo
   * per rider at a time — a scheduled booking must not hold a second welcome discount).
   */
  @Query(
      value =
          """
          SELECT COUNT(*) FROM promo_redemptions pr
          JOIN promos p ON p.promo_id = pr.promo_id
          JOIN rides r ON r.ride_id = pr.ride_id
          WHERE pr.user_id = :userId AND p.first_ride_only
            AND r.state NOT IN ('completed', 'cancelled_by_rider', 'cancelled_by_driver',
                                'no_driver_found')
          """,
      nativeQuery = true)
  long countAliveFirstRideReservations(@Param("userId") UUID userId);
}
