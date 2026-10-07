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
 * Every M5 onboarding event is category {@code account}, audience {@code driver}. Events without a
 * template are not rendered and stay queued until one ships.
 */
@Component
public class NotificationRenderer {

  /** Deep-link screen: the driver's application status. */
  public static final String SCREEN_DRIVER_APPLICATION = "driver_application";

  /** Deep-link screen: the driver's document slots (param {@code documentType}). */
  public static final String SCREEN_DRIVER_DOCUMENTS = "driver_documents";

  /** Deep-link screen: the driver's vehicles. */
  public static final String SCREEN_DRIVER_VEHICLES = "driver_vehicles";

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
                  + " know.",
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
              "مطلوب تعديلات",
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
              "Unfortunately your application was not approved. Open your application for details.",
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
              "Your new vehicle was not approved. Open your vehicles for details.",
              "لم تتم الموافقة على تغيير المركبة",
              "لم تتم الموافقة على مركبتك الجديدة. افتح صفحة المركبات لمعرفة التفاصيل.");
      case DOCUMENT_RENEWAL_SUBMITTED ->
          driver(
              event,
              SCREEN_DRIVER_DOCUMENTS,
              "Renewal submitted",
              "We received your renewed document and will review it soon.",
              "تم إرسال التجديد",
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
              "Your renewed document was not approved. Open your documents for details.",
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
    };
  }

  private static Rendered expiryReminder(NotificationEvent event, Map<String, Object> params) {
    Optional<DocumentType> type = documentType(params.get("documentType"));
    String expiresOn = text(params.get("expiresOn"));
    int daysLeft = number(params.get("daysLeft"));
    String docEn = type.map(NotificationRenderer::documentNameEn).orElse("A document");
    String docAr = type.map(NotificationRenderer::documentNameAr).orElse("إحدى وثائقك");
    String bodyEn =
        "%s expires on %s (%s left). Renew it to keep driving."
            .formatted(capitalize(docEn), expiresOn, daysEn(daysLeft));
    String bodyAr =
        "تنتهي صلاحية %s بتاريخ %s (بقي %s). جدّدها لتستمر في القيادة."
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
