package com.labby.backend.model;

import com.labby.backend.enums.PointsTransactionType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
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
 * One typed points movement (GRW-04/GAME-02, V24): an accrual names its ride, a challenge reward
 * its challenge, a redemption its wallet credit (traceability), an adjustment its admin.
 */
@Entity
@Table(name = "points_transactions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class PointsTransaction {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "points_transaction_id")
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Column(name = "type", nullable = false, length = 10)
  private PointsTransactionType type;

  @Column(name = "points", nullable = false)
  private long points;

  @Column(name = "ride_id")
  private UUID rideId;

  @Column(name = "challenge_id")
  private UUID challengeId;

  @Column(name = "wallet_transaction_id")
  private UUID walletTransactionId;

  @Column(name = "created_by")
  private UUID createdBy;

  @Column(name = "reason", length = 500)
  private String reason;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    createdAt = Objects.requireNonNullElse(createdAt, Instant.now());
  }
}
