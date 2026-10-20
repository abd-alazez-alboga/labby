package com.labby.backend.service;

import com.labby.backend.dto.PromoValidationDto;
import com.labby.backend.dto.ValidatePromoRequestDto;
import com.labby.backend.model.Ride;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * The promo engine (GRW-01/02, growth-v1; owner rulings 1–3, 2026-10-18): validation, the
 * booking-time reservation, and the completion-time application into the stored fare breakdown.
 */
public interface PromoService {

  /**
   * Checks a code for a booking the rider is about to make (UC-R-04 A1).
   *
   * @param userId the rider
   * @param request code and booking context
   * @return the terms, with a preview when an estimate was given
   */
  PromoValidationDto validate(UUID userId, ValidatePromoRequestDto request);

  /**
   * Reserves a code on a just-created ride, inside the booking transaction: every restriction is
   * re-checked under the promo row lock and the redemption row is inserted (one per ride ever). A
   * null or blank code is a no-op.
   *
   * @param userId the booking rider (on a shared ride: the creating or joining member)
   * @param ride the saved ride
   * @param promoCode the code, or null
   */
  void reserve(UUID userId, Ride ride, String promoCode);

  /**
   * Carries a reservation to the linked follow-up ride (a retry, or a driver-cancel redispatch) —
   * the rider keeps their discount; no cap re-check (the dead ride stops counting).
   *
   * @param from the ended ride
   * @param to the new linked ride
   */
  void carry(Ride from, Ride to);

  /**
   * V1 audit I19: a rider's RETRY of a failed ride carries the promo only while it still fits —
   * under the promo lock the total cap and the rider's per-user limit are re-checked (the failed
   * ride stopped counting, so someone else may have taken the last slot meanwhile). Otherwise the
   * retried ride goes on without it.
   *
   * @param from the failed ride
   * @param to the retried ride
   * @return true when the promo was carried (false also when the failed ride had none)
   */
  boolean carryOnRetry(Ride from, Ride to);

  /**
   * Releases one member's reservation on a shared ride they are leaving or dropped from (M13 review
   * H1): the caps free up and another member may apply a promo. A reservation held by someone else
   * stays.
   *
   * @param ride the shared ride
   * @param memberUserId the leaving member
   */
  void releaseMember(Ride ride, UUID memberUserId);

  /**
   * Applies the ride's reservation at completion: the discount against the payer's pre-discount
   * amount (percent or fixed, capped, floor at zero), recorded on the redemption row. Zero when the
   * ride has no reservation or it belongs to another payer (ruling 2: on a shared ride only the
   * redeeming member's own share is discounted).
   *
   * @param ride the completing ride
   * @param payerUserId the payer (the rider, or one member)
   * @param preDiscountAmount the payer's amount before the promo
   * @return the discount, 0..preDiscountAmount
   */
  BigDecimal applyAtCompletion(Ride ride, UUID payerUserId, BigDecimal preDiscountAmount);
}
