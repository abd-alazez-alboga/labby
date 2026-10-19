package com.labby.backend.service;

import com.labby.backend.dto.AdminHelpArticleDto;
import com.labby.backend.dto.AdminHelpCategoryDto;
import com.labby.backend.dto.HelpArticleDto;
import com.labby.backend.dto.HelpArticleSummaryDto;
import com.labby.backend.dto.HelpCategoryDto;
import com.labby.backend.dto.LocalizedTextDto;
import com.labby.backend.dto.SaveHelpArticleRequestDto;
import com.labby.backend.dto.SaveHelpCategoryRequestDto;
import com.labby.backend.enums.ArticleStatus;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.HelpArticle;
import com.labby.backend.model.HelpCategory;
import com.labby.backend.repository.HelpArticleRepository;
import com.labby.backend.repository.HelpCategoryRepository;
import java.time.Clock;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The help center (see {@link HelpCenterService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class HelpCenterServiceImpl implements HelpCenterService {

  static final int MAX_BODY_LENGTH = 20000;
  static final int MIN_QUERY_LENGTH = 2;
  static final int MAX_QUERY_LENGTH = 80;
  static final int MAX_SEARCH_SIZE = 50;

  private static final String CATEGORY = "help_category";
  private static final String ARTICLE = "help_article";

  private final HelpCategoryRepository helpCategoryRepository;
  private final HelpArticleRepository helpArticleRepository;
  private final AuditService auditService;
  private final Clock clock;

  // ---- public reads ----------------------------------------------------------------------------

  @Override
  @Transactional(readOnly = true)
  public List<HelpCategoryDto> publicCategories() {
    Map<UUID, Long> published = counts(ArticleStatus.PUBLISHED);
    return helpCategoryRepository.findAllByOrderBySortOrderAscNameEnAsc().stream()
        .filter(category -> published.containsKey(category.getId()))
        .map(
            category ->
                new HelpCategoryDto(
                    category.getId(),
                    new LocalizedTextDto(category.getNameEn(), category.getNameAr()),
                    category.getSortOrder(),
                    published.get(category.getId())))
        .toList();
  }

  @Override
  @Transactional(readOnly = true)
  public List<HelpArticleSummaryDto> publicArticles(UUID categoryId) {
    List<HelpArticle> articles =
        helpArticleRepository.findByHelpCategoryIdAndStatusOrderBySortOrderAscCreatedAtAsc(
            categoryId, ArticleStatus.PUBLISHED);
    if (articles.isEmpty()) {
      throw new ResourceNotFoundException("Help category not found");
    }
    return articles.stream().map(HelpCenterServiceImpl::summary).toList();
  }

  @Override
  @Transactional(readOnly = true)
  public HelpArticleDto publicArticle(UUID articleId) {
    HelpArticle article =
        helpArticleRepository
            .findByIdAndStatus(articleId, ArticleStatus.PUBLISHED)
            .orElseThrow(() -> new ResourceNotFoundException("Help article not found"));
    return new HelpArticleDto(
        article.getId(),
        article.getHelpCategoryId(),
        new LocalizedTextDto(article.getTitleEn(), article.getTitleAr()),
        article.getSortOrder(),
        new LocalizedTextDto(article.getBodyEn(), article.getBodyAr()),
        article.getPublishedAt());
  }

  @Override
  @Transactional(readOnly = true)
  public List<HelpArticleSummaryDto> search(String query, String lang, int size) {
    String trimmed = query == null ? "" : query.trim();
    if (trimmed.length() < MIN_QUERY_LENGTH) {
      throw (InvalidRequestException)
          new InvalidRequestException("Search needs at least 2 characters")
              .withCode("query_too_short");
    }
    if (trimmed.length() > MAX_QUERY_LENGTH) {
      throw (InvalidRequestException)
          new InvalidRequestException("Search takes at most 80 characters")
              .withCode("query_too_long");
    }
    boolean arabic = "ar".equalsIgnoreCase(lang);
    if (!arabic && !"en".equalsIgnoreCase(lang)) {
      throw new InvalidRequestException("lang must be en or ar");
    }
    String pattern = "%" + escapeLike(trimmed) + "%";
    int limit = Math.clamp(size, 1, MAX_SEARCH_SIZE);
    List<HelpArticle> hits =
        arabic
            ? helpArticleRepository.searchAr(pattern, limit)
            : helpArticleRepository.searchEn(pattern, limit);
    return hits.stream().map(HelpCenterServiceImpl::summary).toList();
  }

  /** Escapes the LIKE wildcards so the query is a literal substring (ESCAPE '\'). */
  static String escapeLike(String text) {
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
  }

  // ---- admin: categories -----------------------------------------------------------------------

  @Override
  @Transactional(readOnly = true)
  public List<AdminHelpCategoryDto> adminCategories() {
    Map<UUID, Long> all = counts(null);
    Map<UUID, Long> published = counts(ArticleStatus.PUBLISHED);
    return helpCategoryRepository.findAllByOrderBySortOrderAscNameEnAsc().stream()
        .map(category -> adminView(category, all, published))
        .toList();
  }

  @Override
  public AdminHelpCategoryDto createCategory(UUID adminUserId, SaveHelpCategoryRequestDto request) {
    HelpCategory category =
        helpCategoryRepository.save(
            HelpCategory.builder()
                .nameEn(request.nameEn().trim())
                .nameAr(request.nameAr().trim())
                .sortOrder(helpCategoryRepository.maxSortOrder() + 1)
                .build());
    auditService.record(
        adminUserId,
        "help_category.create",
        CATEGORY,
        category.getId().toString(),
        null,
        names(category));
    return adminView(category, Map.of(), Map.of());
  }

  @Override
  public AdminHelpCategoryDto renameCategory(
      UUID adminUserId, UUID categoryId, SaveHelpCategoryRequestDto request) {
    HelpCategory category = requireCategory(categoryId);
    Map<String, Object> before = names(category);
    category.setNameEn(request.nameEn().trim());
    category.setNameAr(request.nameAr().trim());
    helpCategoryRepository.save(category);
    auditService.record(
        adminUserId,
        "help_category.update",
        CATEGORY,
        categoryId.toString(),
        before,
        names(category));
    return adminView(category, counts(null), counts(ArticleStatus.PUBLISHED));
  }

  @Override
  public void deleteCategory(UUID adminUserId, UUID categoryId) {
    HelpCategory category = requireCategory(categoryId);
    if (helpArticleRepository.existsByHelpCategoryId(categoryId)) {
      throw (ConflictException)
          new ConflictException("Move or delete the category's articles first")
              .withCode("category_not_empty");
    }
    helpCategoryRepository.delete(category);
    auditService.record(
        adminUserId,
        "help_category.delete",
        CATEGORY,
        categoryId.toString(),
        names(category),
        null);
  }

  @Override
  public void reorderCategories(UUID adminUserId, List<UUID> ids) {
    List<HelpCategory> categories = helpCategoryRepository.findAllByOrderBySortOrderAscNameEnAsc();
    requireCompleteOrder(
        ids, categories.stream().map(HelpCategory::getId).collect(Collectors.toSet()));
    Map<UUID, HelpCategory> byId =
        categories.stream().collect(Collectors.toMap(HelpCategory::getId, category -> category));
    for (int index = 0; index < ids.size(); index++) {
      byId.get(ids.get(index)).setSortOrder(index);
    }
    helpCategoryRepository.saveAll(categories);
    auditService.record(
        adminUserId, "help_category.reorder", CATEGORY, "all", null, Map.of("ids", ids));
  }

  // ---- admin: articles -------------------------------------------------------------------------

  @Override
  @Transactional(readOnly = true)
  public List<AdminHelpArticleDto> adminArticles(UUID categoryId, ArticleStatus status) {
    return helpArticleRepository.findAdminList(categoryId, status).stream()
        .map(HelpCenterServiceImpl::adminView)
        .toList();
  }

  @Override
  @Transactional(readOnly = true)
  public AdminHelpArticleDto adminArticle(UUID articleId) {
    return adminView(requireArticle(articleId));
  }

  @Override
  public AdminHelpArticleDto createArticle(UUID adminUserId, SaveHelpArticleRequestDto request) {
    requireCategory(request.helpCategoryId());
    validateTexts(request);
    HelpArticle article =
        helpArticleRepository.save(
            HelpArticle.builder()
                .helpCategoryId(request.helpCategoryId())
                .titleEn(clean(request.titleEn()))
                .titleAr(clean(request.titleAr()))
                .bodyEn(clean(request.bodyEn()))
                .bodyAr(clean(request.bodyAr()))
                .sortOrder(helpArticleRepository.maxSortOrder(request.helpCategoryId()) + 1)
                .status(ArticleStatus.DRAFT)
                .createdBy(adminUserId)
                .updatedBy(adminUserId)
                .build());
    auditService.record(
        adminUserId,
        "help_article.create",
        ARTICLE,
        article.getId().toString(),
        null,
        state(article));
    return adminView(article);
  }

  @Override
  public AdminHelpArticleDto updateArticle(
      UUID adminUserId, UUID articleId, SaveHelpArticleRequestDto request) {
    HelpArticle article = requireArticle(articleId);
    requireCategory(request.helpCategoryId());
    validateTexts(request);
    Map<String, Object> before = state(article);
    if (!article.getHelpCategoryId().equals(request.helpCategoryId())) {
      article.setHelpCategoryId(request.helpCategoryId());
      article.setSortOrder(helpArticleRepository.maxSortOrder(request.helpCategoryId()) + 1);
    }
    article.setTitleEn(clean(request.titleEn()));
    article.setTitleAr(clean(request.titleAr()));
    article.setBodyEn(clean(request.bodyEn()));
    article.setBodyAr(clean(request.bodyAr()));
    if (article.isPublished()) {
      requireComplete(article);
    }
    article.setUpdatedBy(adminUserId);
    helpArticleRepository.save(article);
    auditService.record(
        adminUserId, "help_article.update", ARTICLE, articleId.toString(), before, state(article));
    return adminView(article);
  }

  @Override
  public void deleteArticle(UUID adminUserId, UUID articleId) {
    HelpArticle article = requireArticle(articleId);
    helpArticleRepository.delete(article);
    auditService.record(
        adminUserId, "help_article.delete", ARTICLE, articleId.toString(), state(article), null);
  }

  @Override
  public AdminHelpArticleDto publish(UUID adminUserId, UUID articleId) {
    HelpArticle article = requireArticle(articleId);
    requireComplete(article);
    if (!article.isPublished()) {
      article.setStatus(ArticleStatus.PUBLISHED);
      article.setPublishedAt(clock.instant());
      article.setUpdatedBy(adminUserId);
      helpArticleRepository.save(article);
    }
    auditService.record(
        adminUserId,
        "help_article.publish",
        ARTICLE,
        articleId.toString(),
        null,
        Map.of("status", "published"));
    return adminView(article);
  }

  @Override
  public AdminHelpArticleDto unpublish(UUID adminUserId, UUID articleId) {
    HelpArticle article = requireArticle(articleId);
    if (article.isPublished()) {
      article.setStatus(ArticleStatus.DRAFT);
      article.setPublishedAt(null);
      article.setUpdatedBy(adminUserId);
      helpArticleRepository.save(article);
    }
    auditService.record(
        adminUserId,
        "help_article.unpublish",
        ARTICLE,
        articleId.toString(),
        null,
        Map.of("status", "draft"));
    return adminView(article);
  }

  @Override
  public void reorderArticles(UUID adminUserId, UUID categoryId, List<UUID> ids) {
    requireCategory(categoryId);
    List<HelpArticle> articles =
        helpArticleRepository.findByHelpCategoryIdOrderBySortOrderAscCreatedAtAsc(categoryId);
    requireCompleteOrder(
        ids, articles.stream().map(HelpArticle::getId).collect(Collectors.toSet()));
    Map<UUID, HelpArticle> byId =
        articles.stream().collect(Collectors.toMap(HelpArticle::getId, article -> article));
    for (int index = 0; index < ids.size(); index++) {
      HelpArticle article = byId.get(ids.get(index));
      article.setSortOrder(index);
      article.setUpdatedBy(adminUserId);
    }
    helpArticleRepository.saveAll(articles);
    auditService.record(
        adminUserId,
        "help_article.reorder",
        CATEGORY,
        categoryId.toString(),
        null,
        Map.of("ids", ids));
  }

  // ---- internals -------------------------------------------------------------------------------

  private Map<UUID, Long> counts(ArticleStatus status) {
    return helpArticleRepository.countByCategory(status).stream()
        .collect(
            Collectors.toMap(
                HelpArticleRepository.CategoryCountRow::getCategoryId,
                HelpArticleRepository.CategoryCountRow::getCount));
  }

  private HelpCategory requireCategory(UUID categoryId) {
    return helpCategoryRepository
        .findById(categoryId)
        .orElseThrow(() -> new ResourceNotFoundException("Help category not found"));
  }

  private HelpArticle requireArticle(UUID articleId) {
    return helpArticleRepository
        .findById(articleId)
        .orElseThrow(() -> new ResourceNotFoundException("Help article not found"));
  }

  private static void validateTexts(SaveHelpArticleRequestDto request) {
    if (clean(request.titleEn()) == null && clean(request.titleAr()) == null) {
      throw (BusinessRuleViolationException)
          new BusinessRuleViolationException("A working title in at least one language is required")
              .withCode("title_required");
    }
    if (length(request.bodyEn()) > MAX_BODY_LENGTH || length(request.bodyAr()) > MAX_BODY_LENGTH) {
      throw (BusinessRuleViolationException)
          new BusinessRuleViolationException("Bodies take at most 20,000 characters")
              .withCode("body_too_long");
    }
  }

  private static void requireComplete(HelpArticle article) {
    List<String> missing = article.missing();
    if (!missing.isEmpty()) {
      throw (BusinessRuleViolationException)
          new BusinessRuleViolationException("Both languages are required to publish")
              .withCode("translation_missing")
              .withDetail("missing", missing);
    }
  }

  private static void requireCompleteOrder(List<UUID> ids, Set<UUID> expected) {
    if (ids == null
        || ids.size() != expected.size()
        || new HashSet<>(ids).size() != ids.size()
        || !expected.containsAll(ids)) {
      throw (BusinessRuleViolationException)
          new BusinessRuleViolationException("The order must name every item exactly once")
              .withCode("order_incomplete");
    }
  }

  private static String clean(String text) {
    return text == null || text.isBlank() ? null : text;
  }

  private static int length(String text) {
    return text == null ? 0 : text.length();
  }

  private static HelpArticleSummaryDto summary(HelpArticle article) {
    return new HelpArticleSummaryDto(
        article.getId(),
        article.getHelpCategoryId(),
        new LocalizedTextDto(article.getTitleEn(), article.getTitleAr()),
        article.getSortOrder());
  }

  private static AdminHelpCategoryDto adminView(
      HelpCategory category, Map<UUID, Long> all, Map<UUID, Long> published) {
    return new AdminHelpCategoryDto(
        category.getId(),
        category.getNameEn(),
        category.getNameAr(),
        category.getSortOrder(),
        all.getOrDefault(category.getId(), 0L),
        published.getOrDefault(category.getId(), 0L),
        category.getCreatedAt(),
        category.getUpdatedAt());
  }

  private static AdminHelpArticleDto adminView(HelpArticle article) {
    return new AdminHelpArticleDto(
        article.getId(),
        article.getHelpCategoryId(),
        article.getTitleEn(),
        article.getTitleAr(),
        article.getBodyEn(),
        article.getBodyAr(),
        article.getSortOrder(),
        article.getStatus(),
        article.getPublishedAt(),
        article.missing(),
        article.getCreatedAt(),
        article.getUpdatedAt());
  }

  private static Map<String, Object> names(HelpCategory category) {
    Map<String, Object> state = new LinkedHashMap<>();
    state.put("nameEn", category.getNameEn());
    state.put("nameAr", category.getNameAr());
    return state;
  }

  private static Map<String, Object> state(HelpArticle article) {
    Map<String, Object> state = new LinkedHashMap<>();
    state.put("helpCategoryId", article.getHelpCategoryId().toString());
    state.put("titleEn", article.getTitleEn());
    state.put("titleAr", article.getTitleAr());
    state.put("status", article.getStatus().getValue());
    state.put("bodyEnLength", length(article.getBodyEn()));
    state.put("bodyArLength", length(article.getBodyAr()));
    return state;
  }
}
