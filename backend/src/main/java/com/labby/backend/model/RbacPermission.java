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

/**
 * A catalog permission row (RBAC-02). The catalog's source of truth is {@link
 * com.labby.backend.enums.Permission}; rows are seeded by V4 and {@code RbacCatalogSeeder} — this
 * entity exists for role grants, never for ad-hoc inserts.
 */
@Entity
@Table(name = "permissions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class RbacPermission {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "permission_id")
  private UUID id;

  @Column(name = "code", nullable = false, unique = true, length = 64)
  private String code;

  @Column(name = "domain", nullable = false, length = 32)
  private String domain;

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
    if (!(other instanceof RbacPermission that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
