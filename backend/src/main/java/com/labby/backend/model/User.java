package com.labby.backend.model;

import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.Language;
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

  @Column(name = "terms_accepted_at")
  private Instant termsAcceptedAt;

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
