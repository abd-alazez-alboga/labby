package com.labby.backend.model;

import com.labby.backend.enums.SettlementDirection;
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
 * The immutable record of off-app money movement (COM-04, UC-A-27). APPEND-ONLY (V12 trigger); a
 * mistake is corrected by a counter-settlement. Each settlement posts exactly one driver ledger
 * entry.
 */
@Entity
@Table(name = "settlements")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Settlement {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "settlement_id")
  private UUID id;

  @Column(name = "driver_user_id", nullable = false)
  private UUID driverUserId;

  @Column(name = "currency", nullable = false, length = 3)
  private String currency;

  @Column(name = "amount", nullable = false)
  private BigDecimal amount;

  @Column(name = "direction", nullable = false, length = 8)
  private SettlementDirection direction;

  @Column(name = "note", length = 500)
  private String note;

  @Column(name = "recorded_by", nullable = false)
  private UUID recordedBy;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    if (createdAt == null) {
      createdAt = Instant.now();
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof Settlement that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
