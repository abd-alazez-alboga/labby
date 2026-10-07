package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.service.NotificationRenderer;
import com.labby.backend.service.NotificationRenderer.Rendered;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * NTF-01 / NFR-I1: every M5 onboarding event renders in English AND Arabic, is category {@code
 * account} for the driver audience, deep-links into the catalog (except a suspension with nothing
 * to act on in the app), and never uses the carrier-filtered "verification" wording.
 */
class NotificationRendererTest {

  private static final Set<String> CATALOG =
      Set.of("driver_application", "driver_documents", "driver_vehicles");

  private final NotificationRenderer renderer = new NotificationRenderer();

  private static final Map<String, Object> REMINDER_PARAMS =
      Map.of("documentType", "drivers_license", "expiresOn", "2026-10-13", "daysLeft", 7);

  @Test
  @DisplayName("every M5 event renders bilingual, account/driver, with a catalog deep link")
  void shouldRenderEveryEventInBothLanguages() {
    for (NotificationEvent event : NotificationEvent.values()) {
      Map<String, Object> params =
          switch (event) {
            case DOCUMENT_EXPIRY_REMINDER -> REMINDER_PARAMS;
            case DRIVER_SUSPENDED -> Map.of("reason", "document_expired");
            default -> Map.of();
          };
      Rendered rendered = renderer.render(event.getValue(), params).orElseThrow();
      assertThat(rendered.event()).isEqualTo(event.getValue());
      assertThat(rendered.category()).isEqualTo(NotificationCategory.ACCOUNT);
      assertThat(rendered.audience()).isEqualTo(NotificationAudience.DRIVER);
      assertThat(rendered.linkScreen()).isIn(CATALOG);
      for (String text :
          new String[] {
            rendered.titleEn(), rendered.bodyEn(), rendered.titleAr(), rendered.bodyAr()
          }) {
        assertThat(text).isNotBlank().doesNotContain("%s", "{", "}", "null");
        assertThat(text.toLowerCase(Locale.ROOT)).doesNotContain("verification", "verify");
        assertThat(text).doesNotContain("التحقق");
      }
      assertThat(rendered.titleAr()).containsPattern("[\\u0600-\\u06FF]");
      assertThat(rendered.bodyAr()).containsPattern("[\\u0600-\\u06FF]");
      assertThat(rendered.titleEn()).doesNotContainPattern("[\\u0600-\\u06FF]");
      assertThat(rendered.titleEn().length()).isLessThanOrEqualTo(200);
      assertThat(rendered.bodyAr().length()).isLessThanOrEqualTo(1000);
    }
    assertThat(renderer.supportedEvents()).hasSize(NotificationEvent.values().length);
  }

  @Test
  @DisplayName("brand: Labby in English, لبي in Arabic")
  void shouldUseTheBrandNames() {
    Rendered approved = renderer.render("driver_application.approved", Map.of()).orElseThrow();
    assertThat(approved.bodyEn()).contains("Labby");
    assertThat(approved.bodyAr()).contains("لبي");
  }

  @Test
  @DisplayName("expiry reminder: document name, date, days with Arabic agreement, doc deep link")
  void shouldRenderTheExpiryReminderParams() {
    Rendered seven = renderer.render("document.expiry_reminder", REMINDER_PARAMS).orElseThrow();
    assertThat(seven.bodyEn())
        .isEqualTo(
            "Your driver's license expires on 2026-10-13 (7 days left). Renew it to keep"
                + " driving.");
    assertThat(seven.bodyAr()).contains("رخصة القيادة", "2026-10-13", "7 أيام");
    assertThat(seven.linkScreen()).isEqualTo("driver_documents");
    assertThat(seven.linkParams()).containsExactly(Map.entry("documentType", "drivers_license"));

    Rendered thirty =
        renderer
            .render(
                "document.expiry_reminder",
                Map.of("documentType", "insurance", "expiresOn", "2026-11-05", "daysLeft", "30"))
            .orElseThrow();
    assertThat(thirty.bodyAr()).contains("30 يوماً");
  }

  @Test
  @DisplayName(
      "suspension copy and link depend on the reason (only document_expired links to documents);"
          + " unknown events are not rendered")
  void shouldRenderSuspensionReasonsAndSkipUnknownEvents() {
    Rendered expired =
        renderer.render("driver.suspended", Map.of("reason", "document_expired")).orElseThrow();
    assertThat(expired.bodyEn()).contains("document has expired");
    assertThat(expired.linkScreen()).isEqualTo("driver_documents");

    for (Map<String, Object> params :
        List.<Map<String, Object>>of(Map.of(), Map.of("reason", "manual"))) {
      Rendered other = renderer.render("driver.suspended", params).orElseThrow();
      assertThat(other.bodyEn()).as("%s", params).contains("Contact support");
      assertThat(other.linkScreen()).as("%s", params).isNull();
      assertThat(other.linkParams()).as("%s", params).isEmpty();
    }
    assertThat(renderer.render("ride.unknown_future_event", Map.of())).isEmpty();
  }
}
