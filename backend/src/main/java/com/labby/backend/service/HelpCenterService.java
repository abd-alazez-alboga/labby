package com.labby.backend.service;

import com.labby.backend.dto.AdminHelpArticleDto;
import com.labby.backend.dto.AdminHelpCategoryDto;
import com.labby.backend.dto.HelpArticleDto;
import com.labby.backend.dto.HelpArticleSummaryDto;
import com.labby.backend.dto.HelpCategoryDto;
import com.labby.backend.dto.SaveHelpArticleRequestDto;
import com.labby.backend.dto.SaveHelpCategoryRequestDto;
import com.labby.backend.enums.ArticleStatus;
import java.util.List;
import java.util.UUID;

/**
 * The help center (SUP-04, UC-S-21, UC-A-23; support-v1.yaml): public reads of published content in
 * both languages with substring search, and the admin CMS whose publish rule needs all four texts.
 */
public interface HelpCenterService {

  /** Categories holding at least one published article, in order. */
  List<HelpCategoryDto> publicCategories();

  /**
   * The published articles of a category, in order; 404 when none is published.
   *
   * @param categoryId the category
   * @return the summaries
   */
  List<HelpArticleSummaryDto> publicArticles(UUID categoryId);

  /**
   * One published article.
   *
   * @param articleId the article
   * @return the article, both languages
   */
  HelpArticleDto publicArticle(UUID articleId);

  /**
   * Case-insensitive substring search on title + body of one language (ruling 7).
   *
   * @param query 2..80 characters after trimming (400 {@code query_too_short})
   * @param lang {@code en} or {@code ar}
   * @param size at most this many results (clamped to 1..50)
   * @return title matches first, then body matches, each in category order
   */
  List<HelpArticleSummaryDto> search(String query, String lang, int size);

  /** Every category with its counts, in order. */
  List<AdminHelpCategoryDto> adminCategories();

  AdminHelpCategoryDto createCategory(UUID adminUserId, SaveHelpCategoryRequestDto request);

  AdminHelpCategoryDto renameCategory(
      UUID adminUserId, UUID categoryId, SaveHelpCategoryRequestDto request);

  /** Deletes an empty category; 409 {@code category_not_empty} otherwise. */
  void deleteCategory(UUID adminUserId, UUID categoryId);

  /** Reorders every category; 422 {@code order_incomplete} unless each is named exactly once. */
  void reorderCategories(UUID adminUserId, List<UUID> ids);

  /**
   * Articles, drafts included, in category then article order.
   *
   * @param categoryId optional category filter
   * @param status optional status filter
   * @return the articles
   */
  List<AdminHelpArticleDto> adminArticles(UUID categoryId, ArticleStatus status);

  AdminHelpArticleDto adminArticle(UUID articleId);

  /**
   * Creates a draft (a working title in at least one language, else 422 {@code title_required}).
   */
  AdminHelpArticleDto createArticle(UUID adminUserId, SaveHelpArticleRequestDto request);

  /**
   * Edits texts or moves the article; blanking a text of a PUBLISHED article is 422 {@code
   * translation_missing}.
   */
  AdminHelpArticleDto updateArticle(
      UUID adminUserId, UUID articleId, SaveHelpArticleRequestDto request);

  void deleteArticle(UUID adminUserId, UUID articleId);

  /** Publishes (idempotent); 422 {@code translation_missing} with {@code details.missing}. */
  AdminHelpArticleDto publish(UUID adminUserId, UUID articleId);

  /** Back to draft (idempotent). */
  AdminHelpArticleDto unpublish(UUID adminUserId, UUID articleId);

  /** Reorders a category's articles; 422 {@code order_incomplete} unless each is named once. */
  void reorderArticles(UUID adminUserId, UUID categoryId, List<UUID> ids);
}
