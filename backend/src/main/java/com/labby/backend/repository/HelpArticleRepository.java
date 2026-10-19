package com.labby.backend.repository;

import com.labby.backend.enums.ArticleStatus;
import com.labby.backend.model.HelpArticle;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Help-center articles (SUP-04, V26). */
public interface HelpArticleRepository extends JpaRepository<HelpArticle, UUID> {

  List<HelpArticle> findByHelpCategoryIdOrderBySortOrderAscCreatedAtAsc(UUID helpCategoryId);

  List<HelpArticle> findByHelpCategoryIdAndStatusOrderBySortOrderAscCreatedAtAsc(
      UUID helpCategoryId, ArticleStatus status);

  Optional<HelpArticle> findByIdAndStatus(UUID id, ArticleStatus status);

  boolean existsByHelpCategoryId(UUID helpCategoryId);

  /** Every article, in category order then article order (the admin list). */
  @Query(
      """
      SELECT a FROM HelpArticle a, HelpCategory c WHERE a.helpCategoryId = c.id
        AND (:categoryId IS NULL OR a.helpCategoryId = :categoryId)
        AND (:status IS NULL OR a.status = :status)
      ORDER BY c.sortOrder, c.nameEn, a.sortOrder, a.createdAt
      """)
  List<HelpArticle> findAdminList(
      @Param("categoryId") UUID categoryId, @Param("status") ArticleStatus status);

  /** (category, count) of the articles in a status — or of all when {@code status} is null. */
  @Query(
      """
      SELECT a.helpCategoryId AS categoryId, COUNT(a) AS count FROM HelpArticle a
      WHERE (:status IS NULL OR a.status = :status) GROUP BY a.helpCategoryId
      """)
  List<CategoryCountRow> countByCategory(@Param("status") ArticleStatus status);

  @Query(
      "SELECT COALESCE(MAX(a.sortOrder), -1) FROM HelpArticle a WHERE a.helpCategoryId = :categoryId")
  int maxSortOrder(@Param("categoryId") UUID categoryId);

  /**
   * UC-S-21 search in English: published articles whose title or body contains the pattern
   * (case-insensitive), title matches first, then body matches, each in category then article order
   * (ruling 7).
   */
  @Query(
      value =
          """
          SELECT a.* FROM help_articles a
            JOIN help_categories c ON c.help_category_id = a.help_category_id
          WHERE a.status = 'published'
            AND (a.title_en ILIKE :pattern ESCAPE '\\' OR a.body_en ILIKE :pattern ESCAPE '\\')
          ORDER BY (a.title_en ILIKE :pattern ESCAPE '\\') DESC, c.sort_order, c.name_en,
                   a.sort_order, a.created_at
          LIMIT :size
          """,
      nativeQuery = true)
  List<HelpArticle> searchEn(@Param("pattern") String pattern, @Param("size") int size);

  /** The Arabic twin of {@link #searchEn}. */
  @Query(
      value =
          """
          SELECT a.* FROM help_articles a
            JOIN help_categories c ON c.help_category_id = a.help_category_id
          WHERE a.status = 'published'
            AND (a.title_ar ILIKE :pattern ESCAPE '\\' OR a.body_ar ILIKE :pattern ESCAPE '\\')
          ORDER BY (a.title_ar ILIKE :pattern ESCAPE '\\') DESC, c.sort_order, c.name_en,
                   a.sort_order, a.created_at
          LIMIT :size
          """,
      nativeQuery = true)
  List<HelpArticle> searchAr(@Param("pattern") String pattern, @Param("size") int size);

  /** One (category, article count) row. */
  interface CategoryCountRow {

    UUID getCategoryId();

    long getCount();
  }
}
