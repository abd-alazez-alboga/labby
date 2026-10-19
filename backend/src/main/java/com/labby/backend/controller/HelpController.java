package com.labby.backend.controller;

import com.labby.backend.dto.HelpArticleDto;
import com.labby.backend.dto.HelpArticleSummaryDto;
import com.labby.backend.dto.HelpCategoryDto;
import com.labby.backend.service.HelpCenterService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The help center for both apps (support-v1.yaml Help: SUP-04, UC-S-21). */
@RestController
@RequestMapping("/api/v1/help")
@Tag(name = "Help", description = "Published help content, both languages, with search")
@RequiredArgsConstructor
public class HelpController {

  private final HelpCenterService helpCenterService;

  /**
   * Categories holding at least one published article, in order.
   *
   * @return 200 with the list
   */
  @GetMapping("/categories")
  @Operation(summary = "Help categories with published articles")
  public ResponseEntity<List<HelpCategoryDto>> categories() {
    return ResponseEntity.ok(helpCenterService.publicCategories());
  }

  /**
   * The published articles of a category, in order.
   *
   * @param helpCategoryId the category
   * @return 200 with the summaries; 404 unknown category or none published
   */
  @GetMapping("/categories/{helpCategoryId}/articles")
  @Operation(summary = "Published articles of a category")
  public ResponseEntity<List<HelpArticleSummaryDto>> articles(@PathVariable UUID helpCategoryId) {
    return ResponseEntity.ok(helpCenterService.publicArticles(helpCategoryId));
  }

  /**
   * One published article, both languages.
   *
   * @param helpArticleId the article
   * @return 200 with the article; 404 unknown or not published
   */
  @GetMapping("/articles/{helpArticleId}")
  @Operation(summary = "One published article")
  public ResponseEntity<HelpArticleDto> article(@PathVariable UUID helpArticleId) {
    return ResponseEntity.ok(helpCenterService.publicArticle(helpArticleId));
  }

  /**
   * Substring search on title + body of one language (UC-S-21 step 3).
   *
   * @param q 2..80 characters
   * @param lang en or ar
   * @param size at most this many (1..50)
   * @return 200 with title matches first; 400 query_too_short
   */
  @GetMapping("/search")
  @Operation(summary = "Search published articles")
  public ResponseEntity<List<HelpArticleSummaryDto>> search(
      @RequestParam String q,
      @RequestParam String lang,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(helpCenterService.search(q, lang, size));
  }
}
