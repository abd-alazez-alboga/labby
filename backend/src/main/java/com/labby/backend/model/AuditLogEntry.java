package com.labby.backend.model;

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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One append-only audit row (RBAC-05). INSERT-only by design: the V4 trigger rejects UPDATE and
 * DELETE at the DB level, so this entity is never updated or removed after save.
 */
@Entity
@Table(name = "audit_log")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class AuditLogEntry {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "audit_log_id")
  private UUID id;

  @Column(name = "actor_user_id", nullable = false)
  private UUID actorUserId;

  @Column(name = "action", nullable = false, length = 64)
  private String action;

  @Column(name = "target_type", length = 32)
  private String targetType;

  @Column(name = "target_id", length = 64)
  private String targetId;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "before_state")
  private String beforeState;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "after_state")
  private String afterState;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    createdAt = Instant.now();
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof AuditLogEntry that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
