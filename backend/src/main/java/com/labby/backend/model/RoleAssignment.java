package com.labby.backend.model;

import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.enums.SuspensionReason;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
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

/** A role held by an account with its own state — role-level granularity per USR-01/USR-04. */
@Entity
@Table(name = "role_assignments")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class RoleAssignment {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "role_assignment_id")
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Column(name = "role", nullable = false, length = 16)
  private Role role;

  @Builder.Default
  @Column(name = "state", nullable = false, length = 16)
  private RoleState state = RoleState.ACTIVE;

  /** The single RBAC role of an admin assignment (SRS §5.1); NULL on non-admin rows (V4 CHECK). */
  @Column(name = "admin_role_id")
  private UUID adminRoleId;

  /** Why the role is suspended (USR-04); set only while suspended (V6 CHECK). */
  @Column(name = "suspension_reason", length = 32)
  private SuspensionReason suspensionReason;

  /** The admin's reason, shown to the user — {@code manual} suspensions only (M11, V17 CHECK). */
  @Column(name = "suspension_note", length = 500)
  private String suspensionNote;

  /** When the current suspension started (M11); null while active. */
  @Column(name = "suspended_at")
  private Instant suspendedAt;

  @Column(name = "granted_at", nullable = false)
  private Instant grantedAt;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @PrePersist
  void onCreate() {
    Instant now = Instant.now();
    createdAt = now;
    updatedAt = now;
    if (grantedAt == null) {
      grantedAt = now;
    }
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
    if (!(other instanceof RoleAssignment that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
