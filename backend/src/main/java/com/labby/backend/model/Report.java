package com.labby.backend.model;

import com.labby.backend.enums.ReportCategory;
import com.labby.backend.enums.ReportStatus;
import com.labby.backend.enums.RideParty;
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
 * A REP-01 report of a ride's counterpart. Its facts never change and it is resolved exactly once
 * ({@code open -> substantiated | unsubstantiated} with resolver, moment and internal notes) — the
 * V17 trigger enforces both; only the resolution fields have setters.
 */
@Entity
@Table(name = "reports")
@Getter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Report {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "report_id")
  private UUID id;

  @Column(name = "ride_id", nullable = false)
  private UUID rideId;

  @Column(name = "reporter_user_id", nullable = false)
  private UUID reporterUserId;

  @Column(name = "reporter_role", nullable = false, length = 6)
  private RideParty reporterRole;

  @Column(name = "reported_user_id", nullable = false)
  private UUID reportedUserId;

  @Column(name = "reported_role", nullable = false, length = 6)
  private RideParty reportedRole;

  @Column(name = "category", nullable = false, length = 24)
  private ReportCategory category;

  @Column(name = "description", length = 2000)
  private String description;

  @Setter
  @Builder.Default
  @Column(name = "status", nullable = false, length = 16)
  private ReportStatus status = ReportStatus.OPEN;

  @Setter
  @Column(name = "resolution_note", length = 2000)
  private String resolutionNote;

  @Setter
  @Column(name = "resolved_by")
  private UUID resolvedBy;

  @Setter
  @Column(name = "resolved_at")
  private Instant resolvedAt;

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
    if (!(other instanceof Report that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
