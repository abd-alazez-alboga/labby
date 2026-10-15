package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** One of at most 3 REP-01 report photos, in upload order (positions 0..2, V17). */
@Entity
@Table(name = "report_photos")
@IdClass(ReportPhoto.Key.class)
@Getter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class ReportPhoto {

  @Id
  @Column(name = "report_id")
  private UUID reportId;

  @Id
  @Column(name = "position")
  private short position;

  @Column(name = "stored_file_id", nullable = false)
  private UUID storedFileId;

  /** The composite primary key (report x position). */
  @Getter
  @NoArgsConstructor
  @AllArgsConstructor
  public static class Key implements Serializable {

    private static final long serialVersionUID = 1L;

    private UUID reportId;
    private short position;

    @Override
    public boolean equals(Object other) {
      if (this == other) {
        return true;
      }
      if (!(other instanceof Key that)) {
        return false;
      }
      return Objects.equals(reportId, that.reportId) && position == that.position;
    }

    @Override
    public int hashCode() {
      return Objects.hash(reportId, position);
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof ReportPhoto that)) {
      return false;
    }
    return reportId != null && reportId.equals(that.reportId) && position == that.position;
  }

  @Override
  public int hashCode() {
    return Objects.hash(reportId, position);
  }
}
