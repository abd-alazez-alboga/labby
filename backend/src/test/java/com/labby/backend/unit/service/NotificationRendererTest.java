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

  private static final Set<NotificationEvent> TRUST_EVENTS =
      Set.of(
          NotificationEvent.ROLE_SUSPENDED,
          NotificationEvent.ROLE_REACTIVATED,
          NotificationEvent.ACCOUNT_SUSPENDED,
          NotificationEvent.ACCOUNT_REACTIVATED,
          NotificationEvent.REPORT_RESOLVED,
          NotificationEvent.DRIVER_METRIC_WARNING);

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
      if (event == NotificationEvent.CHAT_MESSAGE || event == NotificationEvent.SOS_TRIGGERED) {
        continue; // M10 comms events: see shouldRenderCommsEvents.
      }
      if (TRUST_EVENTS.contains(event)) {
        continue; // M11 trust events: see shouldRenderTrustEvents.
      }
      if (event.getValue().startsWith("scheduled.") || event.getValue().startsWith("shared.")) {
        continue; // M12 events: see shouldRenderScheduledEvents / shouldRenderSharedEvents.
      }
      if (event.getValue().startsWith("growth.")) {
        continue; // M13 growth events: see shouldRenderGrowthEvents.
      }
      if (event.getValue().startsWith("support.") || event.getValue().startsWith("lost_item.")) {
        continue; // M14 support events: see shouldRenderSupportEvents.
      }
      if (event.getValue().startsWith("incentive.")) {
        continue; // M15 incentive events: see shouldRenderIncentiveEvents.
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
  @DisplayName("M15 incentive awards: bilingual per kind, account/driver, the incentives screen")
  void shouldRenderIncentiveEvents() {
    Map<String, String> expectedTitles =
        Map.of(
            "weekly_trips", "Weekly trip bonus paid",
            "peak_hours", "Peak-hour bonus paid",
            "rating", "Rating reward paid");
    expectedTitles.forEach(
        (kind, title) -> {
          Rendered rendered =
              renderer
                  .render(
                      NotificationEvent.INCENTIVE_AWARDED.getValue(),
                      Map.of(
                          "kind", kind,
                          "amount", "50000.00",
                          "currency", "SYP",
                          "weekStart", "2026-10-12",
                          "trips", 42,
                          "avgRating", "4.86"))
                  .orElseThrow();
          assertThat(rendered.category()).isEqualTo(NotificationCategory.ACCOUNT);
          assertThat(rendered.audience()).isEqualTo(NotificationAudience.DRIVER);
          assertThat(rendered.linkScreen()).isEqualTo(NotificationRenderer.SCREEN_INCENTIVES);
          assertThat(rendered.titleEn()).isEqualTo(title);
          assertThat(rendered.bodyEn()).contains("SYP 50,000").doesNotContain("%s", "null");
          assertThat(rendered.bodyAr()).contains("50,000 ل.س").containsPattern("[\\u0600-\\u06FF]");
        });
    assertThat(
            renderer
                .render(
                    NotificationEvent.INCENTIVE_AWARDED.getValue(),
                    Map.of(
                        "kind", "rating", "amount", "20", "currency", "SYP", "avgRating", "4.80"))
                .orElseThrow()
                .bodyEn())
        .contains("4.80");
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

  @Test
  @DisplayName(
      "M10 comms: the chat push targets the recipient's party app with the chat deep link and no"
          + " message content; the SOS alert is safety/admin with no link")
  void shouldRenderCommsEvents() {
    Rendered toDriver =
        renderer
            .render(
                "chat.message",
                Map.of(
                    "rideId", "11111111-1111-1111-1111-111111111111",
                    "senderName", "Rana",
                    "recipientRole", "driver",
                    "rideActive", "true"))
            .orElseThrow();
    assertThat(toDriver.category()).isEqualTo(NotificationCategory.CHAT);
    assertThat(toDriver.audience()).isEqualTo(NotificationAudience.DRIVER);
    assertThat(toDriver.titleEn()).isEqualTo("New message");
    assertThat(toDriver.titleAr()).isEqualTo("رسالة جديدة");
    assertThat(toDriver.bodyEn()).contains("Rana");
    assertThat(toDriver.bodyAr()).contains("Rana");
    assertThat(toDriver.linkScreen()).isEqualTo("chat");
    assertThat(toDriver.linkParams())
        .containsEntry("rideId", "11111111-1111-1111-1111-111111111111");
    Rendered toRider =
        renderer
            .render("chat.message", Map.of("senderName", "Omar", "recipientRole", "rider"))
            .orElseThrow();
    assertThat(toRider.audience()).isEqualTo(NotificationAudience.RIDER);

    Rendered sos =
        renderer
            .render(
                "sos.triggered",
                Map.of("rideId", "11111111-1111-1111-1111-111111111111", "role", "rider"))
            .orElseThrow();
    assertThat(sos.category()).isEqualTo(NotificationCategory.SAFETY);
    assertThat(sos.audience()).isEqualTo(NotificationAudience.ADMIN);
    assertThat(sos.bodyEn()).contains("rider");
    assertThat(sos.bodyAr()).contains("راكب");
    assertThat(sos.linkScreen()).isNull();
    Rendered sosDriver = renderer.render("sos.triggered", Map.of("role", "driver")).orElseThrow();
    assertThat(sosDriver.bodyEn()).contains("driver");
    assertThat(sosDriver.bodyAr()).contains("سائق");
  }

  @Test
  @DisplayName(
      "M11 trust: bilingual account notices to the right app, the rule or the admin's reason in"
          + " the text, Western digits, never the report's internal notes")
  void shouldRenderTrustEvents() {
    Rendered lowRating =
        renderer
            .render(
                "account.role_suspended",
                Map.of(
                    "role", "driver",
                    "reason", "low_rating",
                    "minAvgRating", "3",
                    "minRatedRides", 20))
            .orElseThrow();
    assertThat(lowRating.audience()).isEqualTo(NotificationAudience.DRIVER);
    // In-app support arrives only with M14: no "contact support" line (owner ruling 2026-10-15).
    assertThat(lowRating.bodyEn())
        .isEqualTo(
            "Your driver account is suspended because your average rating is below 3 after 20"
                + " rated rides.");
    assertThat(lowRating.bodyAr())
        .isEqualTo("تم إيقاف حساب السائق الخاص بك لأن متوسط تقييمك أقل من 3 بعد 20 رحلة مقيّمة.");
    Rendered riderLow =
        renderer
            .render(
                "account.role_suspended",
                Map.of(
                    "role",
                    "rider",
                    "reason",
                    "low_rating",
                    "minAvgRating",
                    "2.5",
                    "minRatedRides",
                    10))
            .orElseThrow();
    assertThat(riderLow.audience()).isEqualTo(NotificationAudience.RIDER);
    assertThat(riderLow.titleEn()).isEqualTo("Rider account suspended");
    assertThat(riderLow.bodyAr()).contains("10 رحلات مقيّمة");
    Rendered manual =
        renderer
            .render(
                "account.role_suspended",
                Map.of("role", "driver", "reason", "manual", "note", "Repeated complaints"))
            .orElseThrow();
    assertThat(manual.bodyEn()).endsWith("Reason: Repeated complaints");
    assertThat(manual.bodyAr()).endsWith("السبب: Repeated complaints");
    Rendered reactivated =
        renderer
            .render("account.role_reactivated", Map.of("role", "rider", "note", "Appeal ok"))
            .orElseThrow();
    assertThat(reactivated.audience()).isEqualTo(NotificationAudience.RIDER);
    assertThat(reactivated.bodyEn()).contains("Appeal ok");
    Rendered account =
        renderer.render("account.suspended", Map.of("note", "Fraud check")).orElseThrow();
    assertThat(account.audience()).isEqualTo(NotificationAudience.ALL);
    assertThat(account.bodyAr()).contains("Fraud check");
    Rendered substantiated =
        renderer
            .render("report.resolved", Map.of("outcome", "substantiated", "role", "rider"))
            .orElseThrow();
    assertThat(substantiated.audience()).isEqualTo(NotificationAudience.RIDER);
    assertThat(substantiated.bodyEn()).contains("confirmed");
    Rendered unsubstantiated =
        renderer
            .render("report.resolved", Map.of("outcome", "unsubstantiated", "role", "driver"))
            .orElseThrow();
    assertThat(unsubstantiated.audience()).isEqualTo(NotificationAudience.DRIVER);
    assertThat(unsubstantiated.bodyEn()).contains("could not confirm");
    Rendered acceptance =
        renderer
            .render(
                "driver.metric_warning",
                Map.of(
                    "metric", "acceptance",
                    "valuePercent", "42.50",
                    "thresholdPercent", "50",
                    "windowDays", 30))
            .orElseThrow();
    assertThat(acceptance.bodyEn())
        .isEqualTo(
            "Your acceptance rate for the last 30 days is 42.5%, below the 50% minimum. Try to"
                + " accept more ride requests.");
    assertThat(acceptance.bodyAr()).contains("30 يوماً", "42.5%", "50%");
    Rendered cancellation =
        renderer
            .render(
                "driver.metric_warning",
                Map.of(
                    "metric", "cancellation",
                    "valuePercent", "20.00",
                    "thresholdPercent", "15",
                    "windowDays", 7))
            .orElseThrow();
    assertThat(cancellation.titleEn()).isEqualTo("Your cancellation rate is high");
    assertThat(cancellation.bodyAr()).contains("7 أيام", "20%", "15%");
    for (Rendered rendered :
        List.of(
            lowRating,
            riderLow,
            manual,
            reactivated,
            account,
            substantiated,
            unsubstantiated,
            acceptance,
            cancellation)) {
      assertThat(rendered.category()).isEqualTo(NotificationCategory.ACCOUNT);
      assertThat(rendered.linkScreen()).isNull();
      for (String text :
          new String[] {
            rendered.titleEn(), rendered.bodyEn(), rendered.titleAr(), rendered.bodyAr()
          }) {
        assertThat(text).isNotBlank().doesNotContain("%s", "null");
        assertThat(text.toLowerCase(Locale.ROOT)).doesNotContain("verification", "verify");
        assertThat(text).doesNotContain("التحقق").doesNotContainPattern("[\\u0660-\\u0669]");
      }
    }
  }

  @Test
  @DisplayName("M12 scheduled events render bilingual to the right app with the ride deep link")
  void shouldRenderScheduledEvents() {
    Map<String, Object> pickup =
        Map.of(
            "rideId",
            "r-1",
            "driverName",
            "Sami",
            "pickupDate",
            "2026-10-20",
            "pickupTime",
            "09:00");
    Rendered claimed = renderer.render("scheduled.claimed", pickup).orElseThrow();
    assertThat(claimed.bodyEn()).isEqualTo("Sami will pick you up on 2026-10-20 at 09:00.");
    assertThat(claimed.category()).isEqualTo(NotificationCategory.SCHEDULED);
    assertThat(claimed.audience()).isEqualTo(NotificationAudience.RIDER);
    Rendered released = renderer.render("scheduled.released", pickup).orElseThrow();
    Rendered riderDay =
        renderer
            .render(
                "scheduled.reminder",
                Map.of(
                    "rideId", "r-1", "as", "rider", "minutesBefore", 1440, "pickupTime", "09:00"))
            .orElseThrow();
    assertThat(riderDay.bodyEn()).isEqualTo("Your scheduled ride is in 24 hours, at 09:00.");
    assertThat(riderDay.bodyAr()).contains("24 ساعة", "09:00");
    Rendered driverHour =
        renderer
            .render(
                "scheduled.reminder",
                Map.of("rideId", "r-1", "as", "driver", "minutesBefore", 60, "pickupTime", "09:00"))
            .orElseThrow();
    assertThat(driverHour.audience()).isEqualTo(NotificationAudience.DRIVER);
    assertThat(driverHour.bodyEn()).contains("in 1 hour", "Be online");
    assertThat(driverHour.bodyAr()).contains("ساعة");
    Rendered convertedDriver =
        renderer
            .render("scheduled.converted", Map.of("rideId", "r-1", "as", "driver"))
            .orElseThrow();
    assertThat(convertedDriver.audience()).isEqualTo(NotificationAudience.DRIVER);
    Rendered convertedRider =
        renderer
            .render("scheduled.converted", Map.of("rideId", "r-1", "as", "rider"))
            .orElseThrow();
    Rendered busy =
        renderer
            .render("scheduled.cancelled_rider_busy", Map.of("rideId", "r-1", "as", "rider"))
            .orElseThrow();
    assertThat(busy.category()).isEqualTo(NotificationCategory.RIDE);
    Rendered busyDriver =
        renderer
            .render("scheduled.cancelled_rider_busy", Map.of("rideId", "r-1", "as", "driver"))
            .orElseThrow();
    assertThat(busyDriver.audience()).isEqualTo(NotificationAudience.DRIVER);
    Rendered noDriver =
        renderer
            .render("ride.no_driver_found", Map.of("rideId", "r-1", "scheduled", "true"))
            .orElseThrow();
    assertThat(noDriver.titleEn()).isEqualTo("No driver for your scheduled ride");
    for (Rendered rendered :
        List.of(
            claimed,
            released,
            riderDay,
            driverHour,
            convertedDriver,
            convertedRider,
            busy,
            busyDriver,
            noDriver)) {
      assertThat(rendered.linkScreen()).isEqualTo("ride");
      assertThat(rendered.linkParams()).containsEntry("rideId", "r-1");
      for (String text :
          new String[] {
            rendered.titleEn(), rendered.bodyEn(), rendered.titleAr(), rendered.bodyAr()
          }) {
        assertThat(text).isNotBlank().doesNotContain("%s", "null");
        assertThat(text.toLowerCase(Locale.ROOT)).doesNotContain("verification", "verify");
        assertThat(text).doesNotContain("التحقق").doesNotContainPattern("[\\u0660-\\u0669]");
      }
      assertThat(rendered.titleAr()).containsPattern("[\\u0600-\\u06FF]");
    }
  }

  @Test
  @DisplayName("M12 shared events render bilingual to the rider app, never muted")
  void shouldRenderSharedEvents() {
    List<Rendered> rendered =
        List.of(
            renderer.render("shared.dispatched", Map.of("rideId", "r-1")).orElseThrow(),
            renderer
                .render("shared.cancelled", Map.of("rideId", "r-1", "reason", "creator_cancelled"))
                .orElseThrow(),
            renderer
                .render("shared.cancelled", Map.of("rideId", "r-1", "reason", "expired"))
                .orElseThrow(),
            renderer
                .render(
                    "shared.member_no_show",
                    Map.of("rideId", "r-1", "fee", "2.00", "currency", "SYP"))
                .orElseThrow(),
            renderer.render("shared.member_no_show", Map.of("rideId", "r-1")).orElseThrow());
    assertThat(rendered.get(2).bodyEn()).contains("didn't fill up");
    assertThat(rendered.get(3).bodyEn()).contains("cancellation fee");
    for (Rendered one : rendered) {
      assertThat(one.category()).isEqualTo(NotificationCategory.RIDE);
      assertThat(one.audience()).isEqualTo(NotificationAudience.RIDER);
      assertThat(one.linkScreen()).isEqualTo("ride");
      for (String text : new String[] {one.titleEn(), one.bodyEn(), one.titleAr(), one.bodyAr()}) {
        assertThat(text).isNotBlank().doesNotContain("%s", "null");
        assertThat(text).doesNotContainPattern("[\\u0660-\\u0669]");
      }
    }
  }

  @Test
  @DisplayName(
      "M14 support events: bilingual account notices with the ticket/case deep link and the right"
          + " audience")
  void shouldRenderSupportEvents() {
    Map<String, Object> ticketParams = Map.of("ticketId", "t-1");
    Rendered ticketCreated =
        renderer
            .render("support.ticket_created", Map.of("ticketId", "t-1", "kind", "ticket"))
            .orElseThrow();
    assertThat(ticketCreated.audience()).isEqualTo(NotificationAudience.ALL);
    assertThat(ticketCreated.titleEn()).isEqualTo("Ticket received");
    Rendered lostCreated =
        renderer
            .render("support.ticket_created", Map.of("ticketId", "t-1", "kind", "lost_item"))
            .orElseThrow();
    assertThat(lostCreated.titleEn()).isEqualTo("Lost-item case opened");
    Rendered waitingStatus =
        renderer
            .render(
                "support.ticket_status_changed",
                Map.of("ticketId", "t-1", "status", "waiting_on_user"))
            .orElseThrow();
    assertThat(waitingStatus.audience()).isEqualTo(NotificationAudience.ALL);
    assertThat(waitingStatus.titleEn()).isEqualTo("Support needs your reply");
    Rendered closedStatus =
        renderer
            .render("support.ticket_status_changed", Map.of("ticketId", "t-1", "status", "closed"))
            .orElseThrow();
    assertThat(closedStatus.titleEn()).isEqualTo("Ticket closed");
    Rendered message = renderer.render("support.ticket_message", ticketParams).orElseThrow();
    Rendered reminder = renderer.render("support.waiting_reminder", ticketParams).orElseThrow();
    Rendered caseOpened = renderer.render("lost_item.case_opened", ticketParams).orElseThrow();
    assertThat(caseOpened.audience()).isEqualTo(NotificationAudience.DRIVER);
    assertThat(caseOpened.linkScreen()).isEqualTo("lost_item_case");
    Rendered foundRider =
        renderer
            .render(
                "lost_item.case_status_changed",
                Map.of("ticketId", "t-1", "caseStatus", "found", "as", "rider"))
            .orElseThrow();
    assertThat(foundRider.audience()).isEqualTo(NotificationAudience.RIDER);
    assertThat(foundRider.bodyEn()).contains("your item was found");
    Rendered foundDriver =
        renderer
            .render(
                "lost_item.case_status_changed",
                Map.of("ticketId", "t-1", "caseStatus", "found", "as", "driver"))
            .orElseThrow();
    assertThat(foundDriver.audience()).isEqualTo(NotificationAudience.DRIVER);
    assertThat(foundDriver.bodyEn()).isNotEqualTo(foundRider.bodyEn());
    assertThat(foundDriver.linkScreen()).isEqualTo("lost_item_case");
    for (Rendered one :
        List.of(
            ticketCreated,
            lostCreated,
            waitingStatus,
            closedStatus,
            message,
            reminder,
            caseOpened,
            foundRider,
            foundDriver)) {
      assertThat(one.category()).isEqualTo(NotificationCategory.ACCOUNT);
      assertThat(one.linkParams()).containsEntry("ticketId", "t-1");
      for (String text : new String[] {one.titleEn(), one.bodyEn(), one.titleAr(), one.bodyAr()}) {
        assertThat(text).isNotBlank().doesNotContain("%s", "{", "}", "null");
        assertThat(text.toLowerCase(Locale.ROOT)).doesNotContain("verification", "verify");
        assertThat(text).doesNotContain("التحقق").doesNotContainPattern("[\\u0660-\\u0669]");
      }
      assertThat(one.titleAr()).containsPattern("[\\u0600-\\u06FF]");
      assertThat(one.bodyAr()).containsPattern("[\\u0600-\\u06FF]");
      assertThat(one.titleEn()).doesNotContainPattern("[\\u0600-\\u06FF]");
    }
    assertThat(message.linkScreen()).isEqualTo("ticket");
  }

  @Test
  @DisplayName("M13 growth events render bilingual, category promotions, audience from `as`")
  void shouldRenderGrowthEvents() {
    Rendered badge =
        renderer
            .render("growth.badge_awarded", Map.of("badgeCode", "five_star_week", "as", "driver"))
            .orElseThrow();
    Rendered challenge =
        renderer
            .render(
                "growth.challenge_completed",
                Map.of("challengeId", "c-1", "points", "150", "as", "driver"))
            .orElseThrow();
    Rendered referrer =
        renderer
            .render(
                "growth.referral_rewarded",
                Map.of("as", "referrer", "amount", "5000", "currency", "SYP"))
            .orElseThrow();
    Rendered referee =
        renderer
            .render(
                "growth.referral_rewarded",
                Map.of("as", "referee", "amount", "5000", "currency", "SYP"))
            .orElseThrow();

    assertThat(badge.audience()).isEqualTo(NotificationAudience.DRIVER);
    assertThat(badge.bodyEn()).contains("5-star week");
    assertThat(badge.bodyAr()).contains("أسبوع 5 نجوم");
    assertThat(challenge.audience()).isEqualTo(NotificationAudience.DRIVER);
    assertThat(challenge.bodyEn()).contains("150");
    assertThat(referrer.audience()).isEqualTo(NotificationAudience.RIDER);
    assertThat(referee.audience()).isEqualTo(NotificationAudience.RIDER);
    assertThat(referrer.bodyEn()).isNotEqualTo(referee.bodyEn());
    for (Rendered one : List.of(badge, challenge, referrer, referee)) {
      assertThat(one.category()).isEqualTo(NotificationCategory.PROMOTIONS);
      assertThat(one.linkScreen()).isNull();
      for (String text : new String[] {one.titleEn(), one.bodyEn(), one.titleAr(), one.bodyAr()}) {
        assertThat(text).isNotBlank().doesNotContain("%s", "{", "}", "null");
        assertThat(text.toLowerCase(Locale.ROOT)).doesNotContain("verification", "verify");
        assertThat(text).doesNotContain("التحقق").doesNotContainPattern("[\\u0660-\\u0669]");
      }
      assertThat(one.titleAr()).containsPattern("[\\u0600-\\u06FF]");
    }
  }
}
