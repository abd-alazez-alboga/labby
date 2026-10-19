package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** One admin tag on a feedback entry (UC-A-25; V26): trimmed, lower-cased, once per entry. */
@Entity
@Table(name = "feedback_tags")
@IdClass(FeedbackTag.Key.class)
@Getter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class FeedbackTag {

  @Id
  @Column(name = "feedback_id")
  private UUID feedbackId;

  @Id
  @Column(name = "tag", length = 30)
  private String tag;

  @Column(name = "tagged_by", nullable = false)
  private UUID taggedBy;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    if (createdAt == null) {
      createdAt = Instant.now();
    }
  }

  /** The composite primary key (entry x tag). */
  @Getter
  @NoArgsConstructor
  @AllArgsConstructor
  public static class Key implements Serializable {

    private static final long serialVersionUID = 1L;

    private UUID feedbackId;
    private String tag;

    @Override
    public boolean equals(Object other) {
      if (this == other) {
        return true;
      }
      if (!(other instanceof Key that)) {
        return false;
      }
      return Objects.equals(feedbackId, that.feedbackId) && Objects.equals(tag, that.tag);
    }

    @Override
    public int hashCode() {
      return Objects.hash(feedbackId, tag);
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof FeedbackTag that)) {
      return false;
    }
    return feedbackId != null
        && feedbackId.equals(that.feedbackId)
        && tag != null
        && tag.equals(that.tag);
  }

  @Override
  public int hashCode() {
    return Objects.hash(feedbackId, tag);
  }
}
