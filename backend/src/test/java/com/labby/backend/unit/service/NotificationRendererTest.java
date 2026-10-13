package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.service.NotificationRenderer;
import com.labby.backend.service.NotificationRenderer.Rendered;
import java.util.HashMap;
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
      if (event.getValue().startsWith("ride.")) {
        continue; // M7 ride events: see shouldRenderRideEvents.
      }
      if (event.getValue().startsWith("wallet.") || event.getValue().startsWith("driver.balance")) {
        continue; // M8 money events: see shouldRenderMoneyEvents.
      }
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
  @DisplayName("M7 ride events: bilingual, category ride, the right audience and deep link")
  void shouldRenderRideEvents() {
    Map<String, Object> rideParams =
        Map.of(
            "rideId", "11111111-1111-1111-1111-111111111111",
            "driverName", "Sami",
            "total", "4.25",
            "currency", "SYP");
    Map<NotificationEvent, NotificationAudience> audiences =
        Map.of(
            NotificationEvent.RIDE_OFFER, NotificationAudience.DRIVER,
            NotificationEvent.RIDE_ACCEPTED, NotificationAudience.RIDER,
            NotificationEvent.RIDE_DRIVER_ARRIVED, NotificationAudience.RIDER,
            NotificationEvent.RIDE_STARTED, NotificationAudience.RIDER,
            NotificationEvent.RIDE_COMPLETED, NotificationAudience.RIDER,
            NotificationEvent.RIDE_CANCELLED_BY_DRIVER, NotificationAudience.RIDER,
            NotificationEvent.RIDE_CANCELLED_BY_RIDER, NotificationAudience.DRIVER,
            NotificationEvent.RIDE_NO_DRIVER_FOUND, NotificationAudience.RIDER);
    for (Map.Entry<NotificationEvent, NotificationAudience> entry : audiences.entrySet()) {
      NotificationEvent event = entry.getKey();
      Map<String, Object> params =
          event == NotificationEvent.RIDE_OFFER ? Map.of("offerId", "o-1") : rideParams;
      Rendered rendered = renderer.render(event.getValue(), params).orElseThrow();
      assertThat(rendered.category()).isEqualTo(NotificationCategory.RIDE);
      assertThat(rendered.audience()).isEqualTo(entry.getValue());
      for (String text :
          new String[] {
            rendered.titleEn(), rendered.bodyEn(), rendered.titleAr(), rendered.bodyAr()
          }) {
        assertThat(text).isNotBlank().doesNotContain("%s", "{", "}", "null");
      }
      assertThat(rendered.titleAr()).containsPattern("[\\u0600-\\u06FF]");
      assertThat(rendered.bodyAr()).containsPattern("[\\u0600-\\u06FF]");
      switch (event) {
        case RIDE_OFFER -> {
          assertThat(rendered.linkScreen()).isEqualTo("ride_offer");
          assertThat(rendered.linkParams()).containsEntry("offerId", "o-1");
        }
        case RIDE_CANCELLED_BY_RIDER -> assertThat(rendered.linkScreen()).isNull();
        default -> {
          assertThat(rendered.linkScreen()).isEqualTo("ride");
          assertThat(rendered.linkParams())
              .containsEntry("rideId", "11111111-1111-1111-1111-111111111111");
        }
      }
    }
    assertThat(renderer.render("ride.accepted", rideParams).orElseThrow().bodyEn())
        .contains("Sami");
    assertThat(renderer.render("ride.completed", rideParams).orElseThrow().bodyAr())
        .contains("4.25 ل.س");
    Rendered noShow =
        renderer
            .render(
                "ride.cancelled_by_driver",
                Map.of("rideId", "r", "noShow", "true", "fee", "2.00", "currency", "SYP"))
            .orElseThrow();
    assertThat(noShow.bodyEn()).contains("SYP 2 applies");
    assertThat(noShow.bodyAr()).contains("2 ل.س");
    assertThat(
            renderer
                .render("ride.cancelled_by_driver", Map.of("rideId", "r", "noShow", "false"))
                .orElseThrow()
                .bodyEn())
        .contains("another driver");
  }

  @Test
  @DisplayName(
      "M8 money events: bilingual, category account/ride, the right audience, no broken"
          + " placeholders")
  void shouldRenderMoneyEvents() {
    Map<String, Object> moneyParams =
        Map.of(
            "rideId", "11111111-1111-1111-1111-111111111111",
            "amount", "7.25",
            "rate", "0.25",
            "balance", "-45.00",
            "floor", "-50",
            "currency", "SYP");
    Map<NotificationEvent, NotificationAudience> audiences =
        Map.of(
            NotificationEvent.RIDE_WAIT_CHARGE_STARTED, NotificationAudience.RIDER,
            NotificationEvent.WALLET_GRANTED, NotificationAudience.RIDER,
            NotificationEvent.WALLET_REFUNDED, NotificationAudience.RIDER,
            NotificationEvent.DRIVER_BALANCE_WARNING, NotificationAudience.DRIVER,
            NotificationEvent.DRIVER_BALANCE_BLOCKED, NotificationAudience.DRIVER,
            NotificationEvent.DRIVER_BALANCE_UNBLOCKED, NotificationAudience.DRIVER);
    for (Map.Entry<NotificationEvent, NotificationAudience> entry : audiences.entrySet()) {
      Rendered rendered = renderer.render(entry.getKey().getValue(), moneyParams).orElseThrow();
      assertThat(rendered.audience()).isEqualTo(entry.getValue());
      assertThat(rendered.category())
          .isEqualTo(
              entry.getKey() == NotificationEvent.RIDE_WAIT_CHARGE_STARTED
                  ? NotificationCategory.RIDE
                  : NotificationCategory.ACCOUNT);
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
    }
    assertThat(renderer.render("ride.wait_charge_started", moneyParams).orElseThrow().linkParams())
        .containsEntry("rideId", "11111111-1111-1111-1111-111111111111");
    assertThat(renderer.render("wallet.granted", moneyParams).orElseThrow().bodyEn())
        .contains("SYP 7.25");
    assertThat(renderer.render("driver.balance_blocked", moneyParams).orElseThrow().bodyEn())
        .contains("-SYP 45", "-SYP 50");
    assertThat(renderer.render("driver.balance_blocked", moneyParams).orElseThrow().bodyAr())
        .contains("-45 ل.س", "-50 ل.س");
    // PAY-02 completion copies: fully wallet-paid vs wallet + cash remainder.
    Map<String, Object> walletPaid =
        Map.of("rideId", "r", "total", "4.25", "currency", "SYP", "method", "wallet");
    assertThat(renderer.render("ride.completed", walletPaid).orElseThrow().bodyEn())
        .contains("paid from your wallet");
    Map<String, Object> mixed =
        Map.of(
            "rideId", "r",
            "total", "4.25",
            "currency", "SYP",
            "method", "wallet",
            "walletApplied", "3.00",
            "cashDue", "1.25");
    assertThat(renderer.render("ride.completed", mixed).orElseThrow().bodyEn())
        .contains("SYP 4.25", "SYP 3", "SYP 1.25");
    // W8: grouping and SYP without decimals on real amounts, Western digits in Arabic too.
    Map<String, Object> large =
        Map.of(
            "rideId", "r",
            "total", "750000.00",
            "currency", "SYP",
            "method", "wallet",
            "walletApplied", "250000.00",
            "cashDue", "500000.00");
    Rendered largeRendered = renderer.render("ride.completed", large).orElseThrow();
    assertThat(largeRendered.bodyEn()).contains("SYP 750,000", "SYP 250,000", "SYP 500,000");
    assertThat(largeRendered.bodyAr()).contains("750,000 ل.س", "500,000 ل.س");
  }

  @Test
  @DisplayName("M8 re-audit R-W1: the completion push itemizes carried fees in every branch")
  void shouldItemizeCarriedFeesInTheCompletionPush() {
    // Fully wallet-paid, without and with carried fees taken from the wallet.
    Rendered walletOnly = completed(Map.of("total", "4.25", "method", "wallet"));
    assertThat(walletOnly.bodyEn())
        .isEqualTo("Your fare is SYP 4.25. It was paid from your wallet.");
    assertThat(walletOnly.bodyAr()).isEqualTo("أجرة رحلتك 4.25 ل.س. تم دفعها من محفظتك.");
    Rendered walletWithFees =
        completed(Map.of("total", "4.25", "method", "wallet", "carriedWallet", "2.00"));
    assertThat(walletWithFees.bodyEn())
        .isEqualTo(
            "Your fare is SYP 4.25. It was paid from your wallet, together with SYP 2 in carried"
                + " cancellation fees.");
    assertThat(walletWithFees.bodyAr())
        .isEqualTo(
            "أجرة رحلتك 4.25 ل.س. تم دفعها من محفظتك مع 2 ل.س من رسوم الإلغاء المستحقة عليك.");

    // Wallet covered the fare, the fee is earmarked for cash.
    Rendered feeInCash =
        completed(
            Map.of(
                "total", "1.50",
                "method", "wallet",
                "walletApplied", "1.50",
                "cashDue", "2.00",
                "carriedCash", "2.00"));
    assertThat(feeInCash.bodyEn())
        .isEqualTo(
            "Your fare is SYP 1.50. Your wallet covered SYP 1.50 — please pay your driver SYP 2 in"
                + " cash (includes SYP 2 in carried cancellation fees).");
    assertThat(feeInCash.bodyAr())
        .isEqualTo(
            "أجرة رحلتك 1.50 ل.س. غطت محفظتك 1.50 ل.س، يرجى دفع 2 ل.س للسائق نقداً (تشمل 2 ل.س"
                + " من رسوم الإلغاء المستحقة عليك).");

    // Short wallet + cash fee, plus a fee the wallet did pay.
    Rendered mixed =
        completed(
            Map.of(
                "total", "4.25",
                "method", "wallet",
                "walletApplied", "3.00",
                "cashDue", "3.25",
                "carriedCash", "2.00",
                "carriedWallet", "1.00"));
    assertThat(mixed.bodyEn())
        .isEqualTo(
            "Your fare is SYP 4.25. Your wallet covered SYP 3 — please pay your driver SYP 3.25 in"
                + " cash (includes SYP 2 in carried cancellation fees). Your wallet also paid SYP 1"
                + " in carried cancellation fees.");
    assertThat(mixed.bodyAr())
        .isEqualTo(
            "أجرة رحلتك 4.25 ل.س. غطت محفظتك 3 ل.س، يرجى دفع 3.25 ل.س للسائق نقداً (تشمل 2 ل.س"
                + " من رسوم الإلغاء المستحقة عليك). ودفعت محفظتك أيضاً 1 ل.س من رسوم الإلغاء"
                + " المستحقة عليك.");

    // Short wallet without carried fees: unchanged copy.
    Rendered shortWallet =
        completed(
            Map.of(
                "total", "4.25", "method", "wallet", "walletApplied", "3.00", "cashDue", "1.25"));
    assertThat(shortWallet.bodyEn())
        .isEqualTo(
            "Your fare is SYP 4.25. Your wallet covered SYP 3 — please pay your driver SYP 1.25 in"
                + " cash.");
    assertThat(shortWallet.bodyAr())
        .isEqualTo("أجرة رحلتك 4.25 ل.س. غطت محفظتك 3 ل.س، يرجى دفع 1.25 ل.س للسائق نقداً.");

    // Cash ride, with and without a carried fee.
    Rendered cashWithFee =
        completed(Map.of("total", "4.25", "method", "cash", "cashDue", "6.25", "carriedCash", "2"));
    assertThat(cashWithFee.bodyEn())
        .isEqualTo(
            "Your fare is SYP 4.25. Please pay your driver SYP 6.25 in cash (includes SYP 2 in"
                + " carried cancellation fees).");
    assertThat(cashWithFee.bodyAr())
        .isEqualTo(
            "أجرة رحلتك 4.25 ل.س. يرجى دفع 6.25 ل.س للسائق نقداً (تشمل 2 ل.س من رسوم الإلغاء"
                + " المستحقة عليك).");
    Rendered cashOnly = completed(Map.of("total", "4.25", "method", "cash"));
    assertThat(cashOnly.bodyEn())
        .isEqualTo("Your fare is SYP 4.25. Please pay your driver in cash.");
    assertThat(cashOnly.bodyAr()).isEqualTo("أجرة رحلتك 4.25 ل.س. يرجى الدفع للسائق نقداً.");

    for (Rendered rendered :
        List.of(walletOnly, walletWithFees, feeInCash, mixed, shortWallet, cashWithFee, cashOnly)) {
      for (String text : new String[] {rendered.bodyEn(), rendered.bodyAr()}) {
        assertThat(text).doesNotContain("%s", "{", "}", "null", "التحقق");
        assertThat(text.toLowerCase(Locale.ROOT)).doesNotContain("verification", "verify");
      }
    }
  }

  private Rendered completed(Map<String, Object> params) {
    Map<String, Object> all = new HashMap<>(params);
    all.put("rideId", "r");
    all.put("currency", "SYP");
    return renderer.render("ride.completed", all).orElseThrow();
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
  @DisplayName("expiry reminder on the expiry day says 'today' instead of '0 days left'")
  void shouldSayTodayWhenTheDocumentExpiresToday() {
    Rendered today =
        renderer
            .render(
                "document.expiry_reminder",
                Map.of("documentType", "insurance", "expiresOn", "2026-10-07", "daysLeft", 0))
            .orElseThrow();
    assertThat(today.bodyEn())
        .isEqualTo("Your insurance expires today (2026-10-07). Renew it now to keep driving.");
    assertThat(today.bodyAr()).contains("التأمين", "اليوم").doesNotContain("0 يوماً");
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
