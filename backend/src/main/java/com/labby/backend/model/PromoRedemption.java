package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One ride's promo redemption (GRW-02, V24: unique per ride — one promo, never stacked). Inserted
 * at booking as the RESERVATION (ruling 3) with the preview amount; the amount is overwritten at
 * completion with the discount actually applied into the stored fare breakdown. A ride that ends
 * without completing keeps its row as the audit trail but stops counting against the caps (the
 * repository cap counts join live rides); a retry or driver-cancel redispatch carries the promo to
 * the new ride as a fresh row.
 */
@Entity
@Table(name = "promo_redemptions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class PromoRedemption {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "promo_redemption_id")
  private UUID id;

  @Column(name = "promo_id", nullable = false)
  private UUID promoId;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Column(name = "ride_id", nullable = false)
  private UUID rideId;

  @Column(name = "amount", nullable = false)
  private BigDecimal amount;

  @Column(name = "currency", nullable = false, length = 3)
  private String currency;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    createdAt = Objects.requireNonNullElse(createdAt, Instant.now());
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof PromoRedemption that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
