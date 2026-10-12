package com.labby.backend.service;

import com.labby.backend.enums.DocumentType;
import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.SuspensionReason;
import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * The localized notification templates (NTF-01, NFR-I1): renders an outbox event into English AND
 * Arabic text (brand Labby / لبي), its category, audience and deep link (realtime-v1.yaml catalog).
 * Every M5 onboarding event is category {@code account}, audience {@code driver}; every M7 ride
 * event is category {@code ride} (never muted), audience rider or driver (rides-v1.yaml). Events
 * without a template are not rendered and stay queued until one ships.
 */
@Component
public class NotificationRenderer {

  /** Deep-link screen: the driver's application status. */
  public static final String SCREEN_DRIVER_APPLICATION = "driver_application";

  /** Deep-link screen: the driver's document slots (param {@code documentType}). */
  public static final String SCREEN_DRIVER_DOCUMENTS = "driver_documents";

  /** Deep-link screen: the driver's vehicles. */
  public static final String SCREEN_DRIVER_VEHICLES = "driver_vehicles";

  /** Deep-link screen: one ride (param {@code rideId}, M7). */
  public static final String SCREEN_RIDE = "ride";

  /** Deep-link screen: the driver's open offer (param {@code offerId}, M7). */
  public static final String SCREEN_RIDE_OFFER = "ride_offer";

  private static final Set<String> EVENTS =
      Arrays.stream(NotificationEvent.values())
          .map(NotificationEvent::getValue)
          .collect(Collectors.toUnmodifiableSet());

  /**
   * A rendered notification, both languages.
   *
   * @param category the notification category (decides muting)
   * @param audience which client's center lists it / which devices get the push
   * @param event the template key
   * @param titleEn English title
   * @param bodyEn English body
   * @param titleAr Arabic title
   * @param bodyAr Arabic body
   * @param linkScreen deep-link screen id, or null
   * @param linkParams deep-link params (never null)
   */
  public record Rendered(
      NotificationCategory category,
      NotificationAudience audience,
      String event,
      String titleEn,
      String bodyEn,
      String titleAr,
      String bodyAr,
      String linkScreen,
      Map<String, String> linkParams) {}

  /**
   * The event keys that have a template.
   *
   * @return the supported keys
   */
  public Set<String> supportedEvents() {
    return EVENTS;
  }

  /**
   * Renders an outbox event.
   *
   * @param event the template key
   * @param params the template arguments
   * @return the rendering, or empty when the event has no template
   */
  public Optional<Rendered> render(String event, Map<String, Object> params) {
    return Arrays.stream(NotificationEvent.values())
        .filter(candidate -> candidate.getValue().equals(event))
        .findFirst()
        .map(known -> render(known, params == null ? Map.of() : params));
  }

  private Rendered render(NotificationEvent event, Map<String, Object> params) {
    return switch (event) {
      case DRIVER_APPLICATION_SUBMITTED ->
          driver(
              event,
              SCREEN_DRIVER_APPLICATION,
              "Application received",
              "Thanks for applying to drive with Labby. We'll review your application and let you"
                  + " know the outcome.",
              "استلمنا طلبك",
              "شكراً لتقديم طلب القيادة مع لبي. سنراجع طلبك ونبلغك بالنتيجة.");
      case DRIVER_APPLICATION_UNDER_REVIEW ->
          driver(
              event,
              SCREEN_DRIVER_APPLICATION,
              "Application under review",
              "Our team has started reviewing your application.",
              "طلبك قيد المراجعة",
              "بدأ فريقنا بمراجعة طلبك.");
      case DRIVER_APPLICATION_NEEDS_CHANGES ->
          driver(
              event,
              SCREEN_DRIVER_APPLICATION,
              "Changes needed",
              "Some items in your application need updating. Open your application to see what to"
                  + " fix.",
              "طلبك بحاجة إلى تعديلات",
              "بعض بنود طلبك بحاجة إلى تعديل. افتح طلبك لترى ما يجب تصحيحه.");
      case DRIVER_APPLICATION_APPROVED ->
          driver(
              event,
              SCREEN_DRIVER_APPLICATION,
              "You're approved!",
              "Welcome to Labby. You can now go online and start receiving ride requests.",
              "تمت الموافقة على طلبك!",
              "أهلاً بك في لبي. يمكنك الآن بدء العمل واستقبال طلبات الرحلات.");
      case DRIVER_APPLICATION_REJECTED ->
          driver(
              event,
              SCREEN_DRIVER_APPLICATION,
              "Application not approved",
              "Unfortunately, your application was not approved. Open your application for details.",
              "لم تتم الموافقة على طلبك",
              "نأسف، لم تتم الموافقة على طلبك. افتح طلبك لمعرفة التفاصيل.");
      case VEHICLE_SWITCH_SUBMITTED ->
          driver(
              event,
              SCREEN_DRIVER_VEHICLES,
              "Vehicle change submitted",
              "We received your new vehicle and will review it soon.",
              "تم إرسال طلب تغيير المركبة",
              "استلمنا بيانات مركبتك الجديدة وسنراجعها قريباً.");
      case VEHICLE_SWITCH_APPROVED ->
          driver(
              event,
              SCREEN_DRIVER_VEHICLES,
              "New vehicle approved",
              "Your new vehicle is approved and now active.",
              "تمت الموافقة على مركبتك الجديدة",
              "مركبتك الجديدة معتمدة وأصبحت فعّالة الآن.");
      case VEHICLE_SWITCH_REJECTED ->
          driver(
              event,
              SCREEN_DRIVER_VEHICLES,
              "Vehicle change not approved",
              "Your new vehicle was not approved. Open Vehicles for details.",
              "لم تتم الموافقة على تغيير المركبة",
              "لم تتم الموافقة على مركبتك الجديدة. افتح صفحة المركبات لمعرفة التفاصيل.");
      case DOCUMENT_RENEWAL_SUBMITTED ->
          driver(
              event,
              SCREEN_DRIVER_DOCUMENTS,
              "Renewal submitted",
              "We received your renewed document and will review it soon.",
              "تم إرسال طلب التجديد",
              "استلمنا وثيقتك المجدَّدة وسنراجعها قريباً.");
      case DOCUMENT_RENEWAL_APPROVED ->
          driver(
              event,
              SCREEN_DRIVER_DOCUMENTS,
              "Renewal approved",
              "Your renewed document is approved.",
              "تمت الموافقة على التجديد",
              "تمت الموافقة على وثيقتك المجدَّدة.");
      case DOCUMENT_RENEWAL_REJECTED ->
          driver(
              event,
              SCREEN_DRIVER_DOCUMENTS,
              "Renewal not approved",
              "Your renewed document was not approved. Open Documents for details.",
              "لم تتم الموافقة على التجديد",
              "لم تتم الموافقة على وثيقتك المجدَّدة. افتح صفحة الوثائق لمعرفة التفاصيل.");
      case DOCUMENT_EXPIRY_REMINDER -> expiryReminder(event, params);
      case DRIVER_SUSPENDED -> suspended(event, params);
      case DRIVER_REINSTATED ->
          driver(
              event,
              SCREEN_DRIVER_DOCUMENTS,
              "Account active again",
              "Your driver account is active again. You can go online.",
              "أُعيد تفعيل حسابك",
              "أصبح حساب السائق الخاص بك فعّالاً من جديد. يمكنك بدء العمل.");
      case RIDE_OFFER ->
          ride(
              event,
              NotificationAudience.DRIVER,
              SCREEN_RIDE_OFFER,
              Map.of("offerId", text(params.get("offerId"))),
              "New ride request",
              "You have a new ride request. Open the app to respond before it expires.",
              "طلب رحلة جديد",
              "لديك طلب رحلة جديد. افتح التطبيق للرد عليه قبل انتهاء المهلة.");
      case RIDE_ACCEPTED ->
          toRider(
              event,
              params,
              "Your driver is on the way",
              "%s accepted your ride and is heading to your pickup point."
                  .formatted(text(params.get("driverName"))),
              "السائق في الطريق إليك",
              "قبل %s رحلتك وهو في طريقه إلى نقطة الانطلاق."
                  .formatted(text(params.get("driverName"))));
      case RIDE_DRIVER_ARRIVED ->
          toRider(
              event,
              params,
              "Your driver has arrived",
              "%s is waiting for you at the pickup point."
                  .formatted(text(params.get("driverName"))),
              "وصل السائق",
              "%s بانتظارك عند نقطة الانطلاق.".formatted(text(params.get("driverName"))));
      case RIDE_STARTED ->
          toRider(
              event,
              params,
              "Your ride has started",
              "Enjoy your ride with Labby.",
              "بدأت رحلتك",
              "رحلة سعيدة مع لبي.");
      case RIDE_COMPLETED -> completed(event, params);
      case RIDE_CANCELLED_BY_DRIVER -> cancelledByDriver(event, params);
      case RIDE_CANCELLED_BY_RIDER ->
          ride(
              event,
              NotificationAudience.DRIVER,
              null,
              Map.of(),
              "Ride cancelled",
              "The rider cancelled this ride.",
              "أُلغيت الرحلة",
              "ألغى الراكب هذه الرحلة.");
      case RIDE_NO_DRIVER_FOUND ->
          toRider(
              event,
              params,
              "No driver available",
              "We couldn't find a driver right now. Tap to try again.",
              "لا يوجد سائق متاح",
              "لم نجد سائقاً متاحاً حالياً. اضغط لإعادة المحاولة.");
      case RIDE_WAIT_CHARGE_STARTED ->
          toRider(
              event,
              params,
              "Wait time is now charged",
              "Your driver is waiting. From now, wait time adds %s %s per minute to your fare."
                  .formatted(text(params.get("rate")), text(params.get("currency"))),
              "بدأ احتساب وقت الانتظار",
              "سائقك بانتظارك. من الآن، تُضاف %s %s عن كل دقيقة انتظار إلى أجرة رحلتك."
                  .formatted(text(params.get("rate")), text(params.get("currency"))));
      case WALLET_GRANTED ->
          account(
              event,
              NotificationAudience.RIDER,
              "Credit added to your wallet",
              "We added %s %s to your Labby wallet."
                  .formatted(text(params.get("amount")), text(params.get("currency"))),
              "رصيد أُضيف إلى محفظتك",
              "أضفنا %s %s إلى محفظتك في لبي."
                  .formatted(text(params.get("amount")), text(params.get("currency"))));
      case WALLET_REFUNDED ->
          account(
              event,
              NotificationAudience.RIDER,
              "You've been refunded",
              "We refunded %s %s to your Labby wallet."
                  .formatted(text(params.get("amount")), text(params.get("currency"))),
              "تم رد المبلغ",
              "أعدنا %s %s إلى محفظتك في لبي."
                  .formatted(text(params.get("amount")), text(params.get("currency"))));
      case DRIVER_BALANCE_WARNING ->
          account(
              event,
              NotificationAudience.DRIVER,
              "Your balance is getting low",
              ("Your balance is %s %s, close to the limit of %s %s. Settle soon to keep receiving"
                      + " ride requests.")
                  .formatted(
                      text(params.get("balance")),
                      text(params.get("currency")),
                      text(params.get("floor")),
                      text(params.get("currency"))),
              "رصيدك يقترب من الحد",
              "رصيدك %s %s وهو قريب من الحد %s %s. سوِّ رصيدك قريباً لتستمر في استقبال طلبات الرحلات."
                  .formatted(
                      text(params.get("balance")),
                      text(params.get("currency")),
                      text(params.get("floor")),
                      text(params.get("currency"))));
      case DRIVER_BALANCE_BLOCKED ->
          account(
              event,
              NotificationAudience.DRIVER,
              "Ride requests paused",
              ("Your balance reached %s %s, at or below the limit of %s %s. Settle your balance to"
                      + " receive ride requests again.")
                  .formatted(
                      text(params.get("balance")),
                      text(params.get("currency")),
                      text(params.get("floor")),
                      text(params.get("currency"))),
              "توقفت طلبات الرحلات",
              "وصل رصيدك إلى %s %s وهو عند الحد %s %s أو دونه. سوِّ رصيدك لتستقبل طلبات الرحلات من جديد."
                  .formatted(
                      text(params.get("balance")),
                      text(params.get("currency")),
                      text(params.get("floor")),
                      text(params.get("currency"))));
      case DRIVER_BALANCE_UNBLOCKED ->
          account(
              event,
              NotificationAudience.DRIVER,
              "Ride requests resumed",
              ("Thanks for settling. Your balance is now %s %s and you can receive ride requests"
                      + " again.")
                  .formatted(text(params.get("balance")), text(params.get("currency"))),
              "عادت طلبات الرحلات",
              "شكراً لتسوية رصيدك. رصيدك الآن %s %s ويمكنك استقبال طلبات الرحلات من جديد."
                  .formatted(text(params.get("balance")), text(params.get("currency"))));
    };
  }

  /**
   * PAY-02: the completion push says how the fare was (or is to be) paid — fully from the wallet,
   * wallet + cash remainder, or cash (with carried fees added to the cash when dues were
   * collected).
   */
  private static Rendered completed(NotificationEvent event, Map<String, Object> params) {
    String total = text(params.get("total"));
    String currency = text(params.get("currency"));
    String cashDue = text(params.get("cashDue"));
    boolean wallet = "wallet".equals(text(params.get("method")));
    String bodyEn;
    String bodyAr;
    if (wallet && cashDue.isEmpty()) {
      bodyEn = "Your fare is %s %s. It was paid from your wallet.".formatted(total, currency);
      bodyAr = "أجرة رحلتك %s %s. تم دفعها من محفظتك.".formatted(total, currency);
    } else if (wallet) {
      String applied = text(params.get("walletApplied"));
      bodyEn =
          "Your fare is %s %s. Your wallet covered %s %s — please pay your driver %s %s in cash."
              .formatted(total, currency, applied, currency, cashDue, currency);
      bodyAr =
          "أجرة رحلتك %s %s. غطت محفظتك %s %s، يرجى دفع %s %s للسائق نقداً."
              .formatted(total, currency, applied, currency, cashDue, currency);
    } else if (!cashDue.isEmpty()) {
      bodyEn =
          "Your fare is %s %s. With your carried fees, please pay your driver %s %s in cash."
              .formatted(total, currency, cashDue, currency);
      bodyAr =
          "أجرة رحلتك %s %s. مع الرسوم المستحقة عليك، يرجى دفع %s %s للسائق نقداً."
              .formatted(total, currency, cashDue, currency);
    } else {
      bodyEn = "Your fare is %s %s. Please pay your driver in cash.".formatted(total, currency);
      bodyAr = "أجرة رحلتك %s %s. يرجى الدفع للسائق نقداً.".formatted(total, currency);
    }
    return toRider(event, params, "You've arrived", bodyEn, "وصلت إلى وجهتك", bodyAr);
  }

  /** An account-category notice without a deep link (push tap opens the notification center). */
  private static Rendered account(
      NotificationEvent event,
      NotificationAudience audience,
      String titleEn,
      String bodyEn,
      String titleAr,
      String bodyAr) {
    return new Rendered(
        NotificationCategory.ACCOUNT,
        audience,
        event.getValue(),
        titleEn,
        bodyEn,
        titleAr,
        bodyAr,
        null,
        Map.of());
  }

  private static Rendered cancelledByDriver(NotificationEvent event, Map<String, Object> params) {
    if (Boolean.parseBoolean(text(params.get("noShow")))) {
      boolean charged = !text(params.get("fee")).isEmpty();
      return toRider(
          event,
          params,
          "Ride cancelled",
          charged
              ? ("Your driver waited but couldn't find you, so the ride was cancelled. A"
                      + " cancellation fee of %s %s applies.")
                  .formatted(text(params.get("fee")), text(params.get("currency")))
              : "Your driver waited but couldn't find you, so the ride was cancelled.",
          "أُلغيت الرحلة",
          charged
              ? "انتظرك السائق ولم يجدك، فأُلغيت الرحلة. تُطبَّق رسوم إلغاء قدرها %s %s."
                  .formatted(text(params.get("fee")), text(params.get("currency")))
              : "انتظرك السائق ولم يجدك، فأُلغيت الرحلة.");
    }
    return toRider(
        event,
        params,
        "Finding you another driver",
        "Your driver cancelled. We're looking for another driver — you won't be charged.",
        "نبحث لك عن سائق آخر",
        "ألغى السائق الرحلة. نبحث لك عن سائق آخر، ولن تُحتسب عليك أي رسوم.");
  }

  private static Rendered toRider(
      NotificationEvent event,
      Map<String, Object> params,
      String titleEn,
      String bodyEn,
      String titleAr,
      String bodyAr) {
    return ride(
        event,
        NotificationAudience.RIDER,
        SCREEN_RIDE,
        Map.of("rideId", text(params.get("rideId"))),
        titleEn,
        bodyEn,
        titleAr,
        bodyAr);
  }

  private static Rendered ride(
      NotificationEvent event,
      NotificationAudience audience,
      String screen,
      Map<String, String> linkParams,
      String titleEn,
      String bodyEn,
      String titleAr,
      String bodyAr) {
    return new Rendered(
        NotificationCategory.RIDE,
        audience,
        event.getValue(),
        titleEn,
        bodyEn,
        titleAr,
        bodyAr,
        screen,
        linkParams);
  }

  private static Rendered expiryReminder(NotificationEvent event, Map<String, Object> params) {
    Optional<DocumentType> type = documentType(params.get("documentType"));
    String expiresOn = text(params.get("expiresOn"));
    int daysLeft = number(params.get("daysLeft"));
    String docEn = type.map(NotificationRenderer::documentNameEn).orElse("A document");
    String docAr = type.map(NotificationRenderer::documentNameAr).orElse("إحدى وثائقك");
    String bodyEn =
        daysLeft <= 0
            ? "%s expires today (%s). Renew it now to keep driving."
                .formatted(capitalize(docEn), expiresOn)
            : "%s expires on %s (%s left). Renew it to keep driving."
                .formatted(capitalize(docEn), expiresOn, daysEn(daysLeft));
    String bodyAr =
        daysLeft <= 0
            ? "تنتهي صلاحية %s اليوم (%s). جدّد الوثيقة الآن لتستمر في القيادة."
                .formatted(docAr, expiresOn)
            : "تنتهي صلاحية %s بتاريخ %s (بقي %s). جدّد الوثيقة لتستمر في القيادة."
                .formatted(docAr, expiresOn, daysAr(daysLeft));
    return new Rendered(
        NotificationCategory.ACCOUNT,
        NotificationAudience.DRIVER,
        event.getValue(),
        "Document expiring soon",
        bodyEn,
        "وثيقة تقترب من انتهاء صلاحيتها",
        bodyAr,
        SCREEN_DRIVER_DOCUMENTS,
        type.map(known -> Map.of("documentType", known.getValue())).orElse(Map.of()));
  }

  /**
   * A suspension for an expired document links to the documents to renew; any other reason has
   * nothing to act on in the app ("contact support"), so it carries no deep link — a push tap then
   * opens the notification center (realtime-v1.yaml "Deep links").
   */
  private static Rendered suspended(NotificationEvent event, Map<String, Object> params) {
    boolean expiredDocument =
        SuspensionReason.DOCUMENT_EXPIRED.getValue().equals(text(params.get("reason")));
    return driver(
        event,
        expiredDocument ? SCREEN_DRIVER_DOCUMENTS : null,
        "Driver account suspended",
        expiredDocument
            ? "Your driver account is suspended because a document has expired. Renew it to drive"
                + " again."
            : "Your driver account has been suspended. Contact support for details.",
        "تم إيقاف حساب السائق",
        expiredDocument
            ? "تم إيقاف حساب السائق الخاص بك لانتهاء صلاحية إحدى وثائقك. جدّدها لتعود إلى القيادة."
            : "تم إيقاف حساب السائق الخاص بك. تواصل مع الدعم لمعرفة التفاصيل.");
  }

  private static Rendered driver(
      NotificationEvent event,
      String screen,
      String titleEn,
      String bodyEn,
      String titleAr,
      String bodyAr) {
    return new Rendered(
        NotificationCategory.ACCOUNT,
        NotificationAudience.DRIVER,
        event.getValue(),
        titleEn,
        bodyEn,
        titleAr,
        bodyAr,
        screen,
        Map.of());
  }

  private static Optional<DocumentType> documentType(Object value) {
    if (value == null) {
      return Optional.empty();
    }
    try {
      return Optional.of(DocumentType.fromValue(value.toString()));
    } catch (IllegalArgumentException ex) {
      return Optional.empty();
    }
  }

  private static String documentNameEn(DocumentType type) {
    return switch (type) {
      case GOVERNMENT_ID -> "your government ID";
      case DRIVERS_LICENSE -> "your driver's license";
      case VEHICLE_REGISTRATION -> "your vehicle registration";
      case INSURANCE -> "your insurance";
    };
  }

  private static String documentNameAr(DocumentType type) {
    return switch (type) {
      case GOVERNMENT_ID -> "الهوية الشخصية";
      case DRIVERS_LICENSE -> "رخصة القيادة";
      case VEHICLE_REGISTRATION -> "رخصة السير";
      case INSURANCE -> "التأمين";
    };
  }

  private static String daysEn(int days) {
    return days == 1 ? "1 day" : days + " days";
  }

  /** Arabic number–noun agreement for days. */
  static String daysAr(int days) {
    if (days == 1) {
      return "يوم واحد";
    }
    if (days == 2) {
      return "يومان";
    }
    if (days >= 3 && days <= 10) {
      return days + " أيام";
    }
    return days + " يوماً";
  }

  private static String capitalize(String value) {
    return Character.toUpperCase(value.charAt(0)) + value.substring(1);
  }

  private static String text(Object value) {
    return value == null ? "" : value.toString();
  }

  private static int number(Object value) {
    if (value instanceof Number numeric) {
      return numeric.intValue();
    }
    try {
      return value == null ? 0 : Integer.parseInt(value.toString());
    } catch (NumberFormatException ex) {
      return 0;
    }
  }
}
