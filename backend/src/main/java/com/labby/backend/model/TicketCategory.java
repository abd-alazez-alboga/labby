package com.labby.backend.model;

import com.labby.backend.enums.TicketPriority;
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
 * An admin-managed ticket category carrying the default priority (SUP-01/03, UC-A-24; V26). The
 * seeded system row ({@code systemCode = lost_item}) is protected by trigger: never deactivated,
 * never deleted, never pickable on a plain ticket. A category any ticket references is deactivated
 * instead of deleted — existing tickets keep theirs.
 */
@Entity
@Table(name = "ticket_categories")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class TicketCategory {

  /** The seeded system category of lost-item cases (owner ruling 2026-10-19). */
  public static final UUID LOST_ITEM_CATEGORY_ID =
      UUID.fromString("00000000-0000-0000-0000-000000001401");

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "ticket_category_id")
  private UUID id;

  @Column(name = "system_code", length = 16)
  private String systemCode;

  @Column(name = "name_en", nullable = false, length = 80)
  private String nameEn;

  @Column(name = "name_ar", nullable = false, length = 80)
  private String nameAr;

  @Builder.Default
  @Column(name = "default_priority", nullable = false, length = 6)
  private TicketPriority defaultPriority = TicketPriority.NORMAL;

  @Builder.Default
  @Column(name = "sort_order", nullable = false)
  private int sortOrder = 0;

  @Builder.Default
  @Column(name = "active", nullable = false)
  private boolean active = true;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  /**
   * Whether this is the protected system row.
   *
   * @return true for the seeded lost-item category
   */
  public boolean isSystem() {
    return systemCode != null;
  }

  @PrePersist
  void onCreate() {
    Instant now = Instant.now();
    if (createdAt == null) {
      createdAt = now;
    }
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
    if (!(other instanceof TicketCategory that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
