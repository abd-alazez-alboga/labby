package com.labby.backend.controller;

import com.labby.backend.dto.AdminHelpArticleDto;
import com.labby.backend.dto.AdminHelpCategoryDto;
import com.labby.backend.dto.OrderRequestDto;
import com.labby.backend.dto.SaveHelpArticleRequestDto;
import com.labby.backend.dto.SaveHelpCategoryRequestDto;
import com.labby.backend.enums.ArticleStatus;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.HelpCenterService;
import com.labby.backend.util.WireEnums;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The help CMS (support-v1.yaml AdminHelp: SUP-04, UC-A-23). */
@RestController
@RequestMapping("/api/v1/admin/help")
@Tag(name = "AdminHelp", description = "Help categories and articles in EN + AR")
@RequiredArgsConstructor
public class AdminHelpController {

  private final HelpCenterService helpCenterService;

  /** Every category with article counts. */
  @GetMapping("/categories")
  @PreAuthorize("hasAuthority('content:view')")
  @Operation(summary = "All help categories")
  public ResponseEntity<List<AdminHelpCategoryDto>> categories() {
    return ResponseEntity.ok(helpCenterService.adminCategories());
  }

  /** Creates a category, appended last (audited). */
  @PostMapping("/categories")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Create a help category")
  public ResponseEntity<AdminHelpCategoryDto> createCategory(
      @Valid @RequestBody SaveHelpCategoryRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(helpCenterService.createCategory(SecurityUtils.currentUserId(), request));
  }

  /** Reorders the categories (audited); 422 order_incomplete. */
  @PutMapping("/categories/order")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Reorder help categories")
  public ResponseEntity<Void> reorderCategories(@Valid @RequestBody OrderRequestDto request) {
    helpCenterService.reorderCategories(SecurityUtils.currentUserId(), request.ids());
    return ResponseEntity.noContent().build();
  }

  /** Renames a category (audited). */
  @PatchMapping("/categories/{helpCategoryId}")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Rename a help category")
  public ResponseEntity<AdminHelpCategoryDto> renameCategory(
      @PathVariable UUID helpCategoryId, @Valid @RequestBody SaveHelpCategoryRequestDto request) {
    return ResponseEntity.ok(
        helpCenterService.renameCategory(SecurityUtils.currentUserId(), helpCategoryId, request));
  }

  /** Deletes an empty category (audited); 409 category_not_empty. */
  @DeleteMapping("/categories/{helpCategoryId}")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Delete an empty help category")
  public ResponseEntity<Void> deleteCategory(@PathVariable UUID helpCategoryId) {
    helpCenterService.deleteCategory(SecurityUtils.currentUserId(), helpCategoryId);
    return ResponseEntity.noContent().build();
  }

  /** Reorders a category's articles (audited); 422 order_incomplete. */
  @PutMapping("/categories/{helpCategoryId}/articles/order")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Reorder a category's articles")
  public ResponseEntity<Void> reorderArticles(
      @PathVariable UUID helpCategoryId, @Valid @RequestBody OrderRequestDto request) {
    helpCenterService.reorderArticles(SecurityUtils.currentUserId(), helpCategoryId, request.ids());
    return ResponseEntity.noContent().build();
  }

  /** Articles, drafts included, in category then article order. */
  @GetMapping("/articles")
  @PreAuthorize("hasAuthority('content:view')")
  @Operation(summary = "All help articles")
  public ResponseEntity<List<AdminHelpArticleDto>> articles(
      @RequestParam(required = false) UUID categoryId,
      @RequestParam(required = false) String status) {
    return ResponseEntity.ok(
        helpCenterService.adminArticles(
            categoryId, WireEnums.parse(ArticleStatus::fromValue, status, "status")));
  }

  /** Creates a draft (audited); 422 title_required / body_too_long. */
  @PostMapping("/articles")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Create a draft article")
  public ResponseEntity<AdminHelpArticleDto> createArticle(
      @Valid @RequestBody SaveHelpArticleRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(helpCenterService.createArticle(SecurityUtils.currentUserId(), request));
  }

  /** One article, any status. */
  @GetMapping("/articles/{helpArticleId}")
  @PreAuthorize("hasAuthority('content:view')")
  @Operation(summary = "One article, any status")
  public ResponseEntity<AdminHelpArticleDto> article(@PathVariable UUID helpArticleId) {
    return ResponseEntity.ok(helpCenterService.adminArticle(helpArticleId));
  }

  /** Edits texts or moves the article (audited); 422 translation_missing on a published one. */
  @PatchMapping("/articles/{helpArticleId}")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Edit an article")
  public ResponseEntity<AdminHelpArticleDto> updateArticle(
      @PathVariable UUID helpArticleId, @Valid @RequestBody SaveHelpArticleRequestDto request) {
    return ResponseEntity.ok(
        helpCenterService.updateArticle(SecurityUtils.currentUserId(), helpArticleId, request));
  }

  /** Deletes an article (audited). */
  @DeleteMapping("/articles/{helpArticleId}")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Delete an article")
  public ResponseEntity<Void> deleteArticle(@PathVariable UUID helpArticleId) {
    helpCenterService.deleteArticle(SecurityUtils.currentUserId(), helpArticleId);
    return ResponseEntity.noContent().build();
  }

  /** Publishes (audited); 422 translation_missing with details.missing. */
  @PostMapping("/articles/{helpArticleId}/publish")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Publish an article (both languages required)")
  public ResponseEntity<AdminHelpArticleDto> publish(@PathVariable UUID helpArticleId) {
    return ResponseEntity.ok(
        helpCenterService.publish(SecurityUtils.currentUserId(), helpArticleId));
  }

  /** Back to draft (audited). */
  @PostMapping("/articles/{helpArticleId}/unpublish")
  @PreAuthorize("hasAuthority('content:manage')")
  @Operation(summary = "Unpublish an article")
  public ResponseEntity<AdminHelpArticleDto> unpublish(@PathVariable UUID helpArticleId) {
    return ResponseEntity.ok(
        helpCenterService.unpublish(SecurityUtils.currentUserId(), helpArticleId));
  }
}
