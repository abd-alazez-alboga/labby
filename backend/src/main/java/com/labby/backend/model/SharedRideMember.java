package com.labby.backend.model;

import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.enums.SharedMemberStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
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
 * One party of a shared ride, the creator included (RIDE-P2..5, V19). Each party has its own
 * payment method, share, payment status and fee — never the ride's.
 */
@Entity
@Table(name = "shared_ride_members")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class SharedRideMember {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "shared_ride_member_id")
  private UUID id;

  @Column(name = "ride_id", nullable = false)
  private UUID rideId;

  @Column(name = "rider_user_id", nullable = false)
  private UUID riderUserId;

  @Column(name = "is_creator", nullable = false)
  private boolean creator;

  @Column(name = "party_size", nullable = false)
  private short partySize;

  @Column(name = "payment_method", nullable = false, length = 8)
  private PaymentMethod paymentMethod;

  @Builder.Default
  @Column(name = "status", nullable = false, length = 10)
  private SharedMemberStatus status = SharedMemberStatus.JOINED;

  @Column(name = "joined_at", nullable = false)
  private Instant joinedAt;

  @Column(name = "left_at")
  private Instant leftAt;

  @Column(name = "no_show_at")
  private Instant noShowAt;

  @Column(name = "cancellation_reason", length = 24)
  private CancellationReason cancellationReason;

  @Column(name = "cancellation_note", length = 500)
  private String cancellationNote;

  @Column(name = "cancellation_fee")
  private BigDecimal cancellationFee;

  @Column(name = "share_amount")
  private BigDecimal shareAmount;

  @Column(name = "payment_status", length = 12)
  private PaymentStatus paymentStatus;

  @Column(name = "payment_confirmed_at")
  private Instant paymentConfirmedAt;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  /**
   * Whether the party is still holding seats / riding along.
   *
   * @return true while joined
   */
  public boolean isJoined() {
    return status == SharedMemberStatus.JOINED;
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
    if (!(other instanceof SharedRideMember that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
