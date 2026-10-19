package com.labby.backend.service;

import com.labby.backend.dto.PromoValidationDto;
import com.labby.backend.dto.ValidatePromoRequestDto;
import com.labby.backend.enums.PromoType;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Promo;
import com.labby.backend.model.PromoRedemption;
import com.labby.backend.model.Ride;
import com.labby.backend.repository.PromoRedemptionRepository;
import com.labby.backend.repository.PromoRepository;
import com.labby.backend.repository.RideRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * GRW-01/02 (owner rulings 1–3, 2026-10-18). Validation runs read-only for the pre-booking check
 * and again under the promo row lock at reservation, where the caps are counted over live
 * reservations. The discount is applied once, at completion, against the payer's pre-discount
 * amount — stored in the fare breakdown and never recomputed.
 */
@Service
@RequiredArgsConstructor
public class PromoServiceImpl implements PromoService {

  private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

  private final PromoRepository promoRepository;
  private final PromoRedemptionRepository promoRedemptionRepository;
  private final RideRepository rideRepository;
  private final RideAccess rideAccess;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public PromoValidationDto validate(UUID userId, ValidatePromoRequestDto request) {
    rideAccess.requireRider(userId);
    Promo promo = found(request.code());
    check(promo, userId, request.regionId(), request.serviceTypeId(), clock.instant());
    BigDecimal preview =
        request.scheduledAt() != null || request.estimateTotal() == null
            ? null
            : discount(promo, request.estimateTotal());
    return new PromoValidationDto(
        promo.getCode(), promo.getType(), promo.getValue(), promo.getMaxDiscount(), preview);
  }

  @Override
  public void reserve(UUID userId, Ride ride, String promoCode) {
    if (promoCode == null || promoCode.isBlank()) {
      return;
    }
    // Re-found and locked: the caps below are counted while no other booking can reserve.
    Promo promo = promoRepository.lockById(found(promoCode).getId()).orElseThrow();
    check(promo, userId, ride.getRegionId(), ride.getServiceTypeId(), clock.instant());
    if (promo.isFirstRideOnly()
        && promoRedemptionRepository.countAliveFirstRideReservations(userId) > 0) {
      // M13 review W1 (owner ruling 2026-10-19): one alive first-ride reservation per rider — a
      // scheduled booking must not hold a second welcome discount alongside a live one.
      throw conflict(
          "You already have a ride booked with a first-ride promo", "promo_first_ride_only");
    }
    try {
      promoRedemptionRepository.saveAndFlush(
          PromoRedemption.builder()
              .promoId(promo.getId())
              .userId(userId)
              .rideId(ride.getId())
              .amount(reservedAmount(promo, ride))
              .currency(ride.getCurrency())
              .build());
    } catch (DataIntegrityViolationException ex) {
      // One promo per ride, never stacked (V24): another member already holds this ride's promo.
      throw conflict("A promo is already applied to this ride", "promo_already_applied");
    }
  }

  @Override
  public void carry(Ride from, Ride to) {
    promoRedemptionRepository
        .findByRideId(from.getId())
        .ifPresent(
            reservation ->
                promoRedemptionRepository.saveAndFlush(
                    PromoRedemption.builder()
                        .promoId(reservation.getPromoId())
                        .userId(reservation.getUserId())
                        .rideId(to.getId())
                        .amount(reservation.getAmount())
                        .currency(reservation.getCurrency())
                        .build()));
  }

  @Override
  public void releaseMember(Ride ride, UUID memberUserId) {
    promoRedemptionRepository
        .findByRideId(ride.getId())
        .filter(reservation -> reservation.getUserId().equals(memberUserId))
        .ifPresent(promoRedemptionRepository::delete);
  }

  @Override
  public BigDecimal applyAtCompletion(Ride ride, UUID payerUserId, BigDecimal preDiscountAmount) {
    PromoRedemption reservation = promoRedemptionRepository.findByRideId(ride.getId()).orElse(null);
    if (reservation == null || !reservation.getUserId().equals(payerUserId)) {
      return BigDecimal.ZERO;
    }
    Promo promo = promoRepository.findById(reservation.getPromoId()).orElseThrow();
    BigDecimal discount = discount(promo, preDiscountAmount);
    if (discount.signum() > 0) {
      reservation.setAmount(discount);
      promoRedemptionRepository.saveAndFlush(reservation);
    }
    return discount;
  }

  /** The discount for an amount: percent (capped) or fixed, never above the amount (floor 0). */
  private static BigDecimal discount(Promo promo, BigDecimal amount) {
    BigDecimal raw =
        promo.getType() == PromoType.PERCENT
            ? amount.multiply(promo.getValue()).divide(HUNDRED, 2, RoundingMode.HALF_UP)
            : promo.getValue();
    if (promo.getMaxDiscount() != null && raw.compareTo(promo.getMaxDiscount()) > 0) {
      raw = promo.getMaxDiscount();
    }
    return raw.min(amount).setScale(2, RoundingMode.HALF_UP);
  }

  /** The reservation row's amount: the preview against the booking estimate, at least 0.01. */
  private static BigDecimal reservedAmount(Promo promo, Ride ride) {
    return discount(promo, ride.getEstimateTotal()).max(new BigDecimal("0.01"));
  }

  private Promo found(String code) {
    return promoRepository
        .findByCode(code.trim().toUpperCase(Locale.ROOT))
        .filter(Promo::isActive)
        .orElseThrow(
            () ->
                (ResourceNotFoundException)
                    new ResourceNotFoundException("This promo code does not exist")
                        .withCode("promo_not_found"));
  }

  /** Every GRW-02 restriction, in the order the contract names them. */
  private void check(Promo promo, UUID userId, UUID regionId, UUID serviceTypeId, Instant now) {
    if (now.isBefore(promo.getStartsAt()) || !now.isBefore(promo.getEndsAt())) {
      throw conflict("This promo is not running now", "promo_window");
    }
    if (promo.getTotalCap() != null
        && promoRedemptionRepository.countingAgainstCap(promo.getId()) >= promo.getTotalCap()) {
      throw conflict("This promo has been fully redeemed", "promo_exhausted");
    }
    if (promoRedemptionRepository.countingAgainstUserLimit(promo.getId(), userId)
        >= promo.getPerUserLimit()) {
      throw conflict("You have already used this promo", "promo_user_limit");
    }
    if (promo.isFirstRideOnly() && rideRepository.riderCompletedCount(userId) > 0) {
      throw conflict("This promo is for first rides only", "promo_first_ride_only");
    }
    if (promo.getRegionId() != null && !promo.getRegionId().equals(regionId)) {
      throw conflict("This promo is not valid in this area", "promo_wrong_region");
    }
    if (promo.getServiceTypeId() != null && !promo.getServiceTypeId().equals(serviceTypeId)) {
      throw conflict("This promo is not valid for this service type", "promo_wrong_service");
    }
  }

  private static ConflictException conflict(String message, String code) {
    return (ConflictException) new ConflictException(message).withCode(code);
  }
}
