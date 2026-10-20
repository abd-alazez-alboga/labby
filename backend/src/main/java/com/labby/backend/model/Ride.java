package com.labby.backend.model;

import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.enums.PickupDistanceMode;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.locationtech.jts.geom.Point;

/**
 * One ride (RIDE-01..08). State machine and its legal transitions: rides-v1.yaml. Every reached
 * state keeps its timestamp; pricing inputs (surge multiplier, surcharge %, and the V33 rate /
 * extras / cancellation snapshot) are locked at request. Stops are {@code [{"lat", "lng",
 * "label"?}]}; the estimate components are the FareComponents shape. {@code version} makes
 * concurrent writers on the same ride lose with 409.
 */
@Entity
@Table(name = "rides")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Ride {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "ride_id")
  private UUID id;

  @Column(name = "rider_user_id", nullable = false)
  private UUID riderUserId;

  @Column(name = "driver_user_id")
  private UUID driverUserId;

  @Column(name = "vehicle_id")
  private UUID vehicleId;

  @Column(name = "region_id", nullable = false)
  private UUID regionId;

  @Column(name = "service_type_id", nullable = false)
  private UUID serviceTypeId;

  @Builder.Default
  @Column(name = "kind", nullable = false, length = 12)
  private RideKind kind = RideKind.ON_DEMAND;

  @Builder.Default
  @Column(name = "state", nullable = false, length = 20)
  private RideState state = RideState.REQUESTED;

  @Column(name = "pickup", nullable = false, columnDefinition = "geometry(Point,4326)")
  private Point pickup;

  @Column(name = "pickup_label", length = 200)
  private String pickupLabel;

  @Column(name = "destination", nullable = false, columnDefinition = "geometry(Point,4326)")
  private Point destination;

  @Column(name = "destination_label", length = 200)
  private String destinationLabel;

  @Builder.Default
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "stops", nullable = false)
  private List<Map<String, Object>> stops = new ArrayList<>();

  @Column(name = "payment_method", nullable = false, length = 8)
  private PaymentMethod paymentMethod;

  @Column(name = "pickup_distance_mode", nullable = false, length = 20)
  private PickupDistanceMode pickupDistanceMode;

  @Column(name = "currency", nullable = false, length = 3)
  private String currency;

  @Column(name = "surge_multiplier", nullable = false)
  private BigDecimal surgeMultiplier;

  @Column(name = "surcharge_percent", nullable = false)
  private BigDecimal surchargePercent;

  @Column(name = "estimate_total", nullable = false)
  private BigDecimal estimateTotal;

  @Column(name = "estimate_distance_m", nullable = false)
  private int estimateDistanceM;

  @Column(name = "estimate_duration_s", nullable = false)
  private int estimateDurationS;

  @Column(name = "estimate_approximate", nullable = false)
  private boolean estimateApproximate;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "estimate_components", nullable = false)
  private Map<String, Object> estimateComponents;

  /**
   * V33 (V1 audit H4): the locked pricing inputs; null on rides created before it (live config).
   */
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "pricing_snapshot")
  private PricingSnapshot pricingSnapshot;

  @Column(name = "retry_of_ride_id")
  private UUID retryOfRideId;

  @Column(name = "redispatch_of_ride_id")
  private UUID redispatchOfRideId;

  @Column(name = "requested_at", nullable = false)
  private Instant requestedAt;

  @Column(name = "offering_at")
  private Instant offeringAt;

  @Column(name = "accepted_at")
  private Instant acceptedAt;

  @Column(name = "driver_arrived_at")
  private Instant driverArrivedAt;

  @Column(name = "started_at")
  private Instant startedAt;

  @Column(name = "completed_at")
  private Instant completedAt;

  @Column(name = "cancelled_at")
  private Instant cancelledAt;

  @Column(name = "no_driver_found_at")
  private Instant noDriverFoundAt;

  @Column(name = "cancellation_grace_ends_at")
  private Instant cancellationGraceEndsAt;

  @Column(name = "cancellation_reason", length = 24)
  private CancellationReason cancellationReason;

  @Column(name = "cancellation_note", length = 500)
  private String cancellationNote;

  @Column(name = "cancellation_fee")
  private BigDecimal cancellationFee;

  @Column(name = "payment_status", length = 12)
  private PaymentStatus paymentStatus;

  @Column(name = "payment_confirmed_at")
  private Instant paymentConfirmedAt;

  @Column(name = "payment_note", length = 500)
  private String paymentNote;

  @Column(name = "driver_stream_lost_at")
  private Instant driverStreamLostAt;

  @Column(name = "eta_seconds")
  private Integer etaSeconds;

  @Column(name = "eta_refreshed_at")
  private Instant etaRefreshedAt;

  @Version
  @Column(name = "version", nullable = false)
  private long version;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  /**
   * Whether the ride is between booking and the end of the trip (one per rider, UC-R-04 E4).
   *
   * @return true for requested, offering, accepted, driver_arrived and in_progress
   */
  public boolean isActive() {
    return switch (state) {
      case REQUESTED, OFFERING, ACCEPTED, DRIVER_ARRIVED, IN_PROGRESS -> true;
      default -> false;
    };
  }

  /**
   * Whether a driver is bound and the trip has not ended (tracking, relay, offline block).
   *
   * @return true for accepted, driver_arrived and in_progress
   */
  public boolean isAssigned() {
    return state == RideState.ACCEPTED
        || state == RideState.DRIVER_ARRIVED
        || state == RideState.IN_PROGRESS;
  }

  @PrePersist
  void onCreate() {
    Instant now = Instant.now();
    createdAt = now;
    updatedAt = now;
  }

  @PreUpdate
  void onUpdate() {
    updatedAt = Instant.now();
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof Ride that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
