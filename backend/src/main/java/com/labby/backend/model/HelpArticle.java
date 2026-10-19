package com.labby.backend.model;

import com.labby.backend.enums.ArticleStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A help-center article (SUP-04, UC-A-23; V26). A draft may be half-written (a working title in
 * either language is enough); publishing with any of the four texts blank is refused (422 {@code
 * translation_missing}) and impossible at the DB level. Bodies are plain text, 20,000 characters
 * max (owner ruling).
 */
@Entity
@Table(name = "help_articles")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class HelpArticle {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "help_article_id")
  private UUID id;

  @Column(name = "help_category_id", nullable = false)
  private UUID helpCategoryId;

  @Column(name = "title_en", length = 160)
  private String titleEn;

  @Column(name = "title_ar", length = 160)
  private String titleAr;

  @Column(name = "body_en", columnDefinition = "text")
  private String bodyEn;

  @Column(name = "body_ar", columnDefinition = "text")
  private String bodyAr;

  @Builder.Default
  @Column(name = "sort_order", nullable = false)
  private int sortOrder = 0;

  @Builder.Default
  @Column(name = "status", nullable = false, length = 9)
  private ArticleStatus status = ArticleStatus.DRAFT;

  @Column(name = "published_at")
  private Instant publishedAt;

  @Column(name = "created_by", nullable = false)
  private UUID createdBy;

  @Column(name = "updated_by", nullable = false)
  private UUID updatedBy;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  /**
   * The blank fields that block publishing (support-v1 {@code AdminHelpArticle.missing}).
   *
   * @return the field names among titleEn, titleAr, bodyEn, bodyAr; empty when publishable
   */
  public List<String> missing() {
    List<String> missing = new ArrayList<>();
    if (isBlank(titleEn)) {
      missing.add("titleEn");
    }
    if (isBlank(titleAr)) {
      missing.add("titleAr");
    }
    if (isBlank(bodyEn)) {
      missing.add("bodyEn");
    }
    if (isBlank(bodyAr)) {
      missing.add("bodyAr");
    }
    return missing;
  }

  /**
   * Whether the article is live in the apps.
   *
   * @return true when published
   */
  public boolean isPublished() {
    return status == ArticleStatus.PUBLISHED;
  }

  private static boolean isBlank(String text) {
    return text == null || text.isBlank();
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
    if (!(other instanceof HelpArticle that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
