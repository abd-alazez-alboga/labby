package com.labby.backend.model;

import com.labby.backend.enums.FlagKind;
import com.labby.backend.enums.FlagStatus;
import com.labby.backend.enums.RideParty;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
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

/**
 * One entry of the flagged-accounts queue (ADM-04, UC-A-16): a user x role flagged for low rating
 * (RATE-03), a metric warning (DRV-07) or the report threshold (REP-03), with the triggering
 * evaluation in {@code details} (shape per kind, trust-v1.yaml). At most one OPEN flag per user x
 * role x kind (V17); closing it always carries a note.
 */
@Entity
@Table(name = "account_flags")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class AccountFlag {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "account_flag_id")
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Column(name = "role", nullable = false, length = 6)
  private RideParty role;

  @Column(name = "kind", nullable = false, length = 16)
  private FlagKind kind;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "details", nullable = false)
  private Map<String, Object> details;

  @Builder.Default
  @Column(name = "status", nullable = false, length = 10)
  private FlagStatus status = FlagStatus.OPEN;

  @Column(name = "raised_at", nullable = false)
  private Instant raisedAt;

  @Column(name = "resolved_by")
  private UUID resolvedBy;

  @Column(name = "resolved_at")
  private Instant resolvedAt;

  @Column(name = "resolution_note", length = 2000)
  private String resolutionNote;

  @PrePersist
  void onCreate() {
    if (raisedAt == null) {
      raisedAt = Instant.now();
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof AccountFlag that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
