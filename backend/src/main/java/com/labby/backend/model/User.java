package com.labby.backend.model;

import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.Language;
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

/**
 * Account identified solely by phone (ES-02). Deletion is the {@code state} column, NOT a
 * hide-on-soft-delete pattern: re-registration must find and reactivate the row (USR-07), so this
 * entity deliberately carries no {@code @SQLDelete}/{@code @SQLRestriction} (documented in
 * V2__users_auth.sql).
 */
@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class User {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "user_id")
  private UUID id;

  @Column(name = "phone", nullable = false, unique = true, length = 20)
  private String phone;

  @Column(name = "password_hash", nullable = false)
  private String passwordHash;

  @Column(name = "name", nullable = false, length = 100)
  private String name;

  @Column(name = "photo_path")
  private String photoPath;

  @Builder.Default
  @Column(name = "language", nullable = false, length = 2)
  private Language language = Language.EN;

  @Builder.Default
  @Column(name = "state", nullable = false, length = 16)
  private AccountState state = AccountState.ACTIVE;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @Column(name = "created_by")
  private UUID createdBy;

  @Column(name = "updated_by")
  private UUID updatedBy;

  @Column(name = "deleted_at")
  private Instant deletedAt;

  /**
   * V34 (V1 audit I20): when a deleted account was last reactivated — stamped by the database
   * trigger on the deleted → active transition, read-only here.
   */
  @Column(name = "reactivated_at", insertable = false, updatable = false)
  private Instant reactivatedAt;

  @Column(name = "terms_accepted_at")
  private Instant termsAcceptedAt;

  /**
   * USR-06 whole-account suspension (M11, "deactivate"): only an admin does it, so the only reason
   * is {@code manual}; set only while {@code state} is suspended, with the mandatory note (V17).
   */
  @Column(name = "suspension_reason", length = 32)
  private SuspensionReason suspensionReason;

  /** The admin's reason for a whole-account suspension, shown to the user (M11). */
  @Column(name = "suspension_note", length = 500)
  private String suspensionNote;

  @Column(name = "suspended_at")
  private Instant suspendedAt;

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
    if (!(other instanceof User user)) {
      return false;
    }
    return id != null && id.equals(user.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
