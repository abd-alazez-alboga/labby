package com.labby.backend.model;

import com.labby.backend.enums.OfferResponse;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
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
 * One sequential-dispatch offer (RIDE-03): ride × driver in candidate order. {@code response} null
 * means open; the database allows one open offer per ride and per driver.
 */
@Entity
@Table(name = "ride_offers")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class RideOffer {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "ride_offer_id")
  private UUID id;

  @Column(name = "ride_id", nullable = false)
  private UUID rideId;

  @Column(name = "driver_user_id", nullable = false)
  private UUID driverUserId;

  @Column(name = "vehicle_id", nullable = false)
  private UUID vehicleId;

  @Column(name = "sequence", nullable = false)
  private short sequence;

  @Column(name = "pickup_distance_m", nullable = false)
  private int pickupDistanceM;

  @Column(name = "pickup_eta_s", nullable = false)
  private int pickupEtaS;

  @Column(name = "offered_at", nullable = false)
  private Instant offeredAt;

  @Column(name = "expires_at", nullable = false)
  private Instant expiresAt;

  @Column(name = "response", length = 10)
  private OfferResponse response;

  @Column(name = "responded_at")
  private Instant respondedAt;

  /**
   * Whether the offer is still awaiting an answer.
   *
   * @return true while open
   */
  public boolean isOpen() {
    return response == null;
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof RideOffer that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
