package com.labby.backend.model;

import com.labby.backend.enums.ReviewStatus;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.ListIndexBase;

/**
 * A driver's vehicle (DRV-03). Exactly one per driver may be active — enforced by the partial
 * unique index {@code uq_vehicles_one_active_per_driver}; only an approved vehicle may be active
 * (V6 CHECK). The application's vehicle and every switch candidate are rows here.
 */
@Entity
@Table(name = "vehicles")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Vehicle {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "vehicle_id")
  private UUID id;

  @Column(name = "driver_user_id", nullable = false)
  private UUID driverUserId;

  @Column(name = "make", nullable = false, length = 50)
  private String make;

  @Column(name = "model", nullable = false, length = 50)
  private String model;

  @Column(name = "year", nullable = false)
  private short year;

  @Column(name = "color", nullable = false, length = 30)
  private String color;

  /** Normalized: upper-case, no spaces (onboarding-v1.yaml). */
  @Column(name = "plate", nullable = false, length = 20)
  private String plate;

  @Column(name = "seats", nullable = false)
  private short seats;

  @Builder.Default
  @Column(name = "review_status", nullable = false, length = 20)
  private ReviewStatus reviewStatus = ReviewStatus.PENDING;

  @Column(name = "review_note", length = 1000)
  private String reviewNote;

  @Column(name = "reviewed_by")
  private UUID reviewedBy;

  @Column(name = "reviewed_at")
  private Instant reviewedAt;

  @Builder.Default
  @Column(name = "is_active", nullable = false)
  private boolean active = false;

  /** 1..4 photo file ids in display order; the first is the one riders see. */
  @Builder.Default
  @ElementCollection
  @CollectionTable(name = "vehicle_photos", joinColumns = @JoinColumn(name = "vehicle_id"))
  @OrderColumn(name = "position")
  @ListIndexBase(1)
  @Column(name = "stored_file_id", nullable = false)
  private List<UUID> photoFileIds = new ArrayList<>();

  /** Service types assigned by the admin at approval (DRV-03). */
  @Builder.Default
  @ElementCollection
  @CollectionTable(name = "vehicle_service_types", joinColumns = @JoinColumn(name = "vehicle_id"))
  @Column(name = "service_type_id", nullable = false)
  private Set<UUID> serviceTypeIds = new HashSet<>();

  @Version
  @Column(name = "version", nullable = false)
  private long version;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

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
    if (!(other instanceof Vehicle that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
