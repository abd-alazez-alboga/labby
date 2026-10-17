package com.labby.backend.service;

import com.labby.backend.enums.DocumentType;
import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.SuspensionReason;
import com.labby.backend.util.MoneyFormat;
import java.math.BigDecimal;
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

  /** Deep-link screen: a ride's chat thread (param {@code rideId}, M10). */
  public static final String SCREEN_CHAT = "chat";

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
          "true".equals(text(params.get("shared")))
              // Review W5 (owner ruling 2026-10-17): a shared ride ends here — no retry.
              ? toRider(
                  event,
                  params,
                  "No driver for your shared ride",
                  "No driver took this shared ride, so it ended. You weren't charged. Create or"
                      + " join another shared ride.",
                  "لا يوجد سائق لرحلتك المشتركة",
                  "لم يقبل أي سائق هذه الرحلة المشتركة، فانتهت. لم تُحتسب عليك أي رسوم. أنشئ رحلة"
                      + " مشتركة أخرى أو انضم إلى واحدة.")
              : "true".equals(text(params.get("scheduled")))
                  // RIDE-S4: the fallback of a scheduled ride failed — early enough to replan.
                  ? toRider(
                      event,
                      params,
                      "No driver for your scheduled ride",
                      "We couldn't find a driver for your scheduled ride. Please make other plans, or"
                          + " tap to try again.",
                      "لا يوجد سائق لرحلتك المجدولة",
                      "لم نجد سائقاً لرحلتك المجدولة. يُرجى ترتيب بديل، أو اضغط لإعادة المحاولة.")
                  : toRider(
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
              "Your driver is waiting. From now, wait time adds %s per minute to your fare."
                  .formatted(moneyEn(params, "rate")),
              "بدأ احتساب وقت الانتظار",
              "سائقك بانتظارك. من الآن، تُضاف %s عن كل دقيقة انتظار إلى أجرة رحلتك."
                  .formatted(moneyAr(params, "rate")));
      case WALLET_GRANTED ->
          account(
              event,
              NotificationAudience.RIDER,
              "Credit added to your wallet",
              "We added %s to your Labby wallet.".formatted(moneyEn(params, "amount")),
              "رصيد أُضيف إلى محفظتك",
              "أضفنا %s إلى محفظتك في لبي.".formatted(moneyAr(params, "amount")));
      case WALLET_REFUNDED ->
          account(
              event,
              NotificationAudience.RIDER,
              "You've been refunded",
              "We refunded %s to your Labby wallet.".formatted(moneyEn(params, "amount")),
              "تم رد المبلغ",
              "أعدنا %s إلى محفظتك في لبي.".formatted(moneyAr(params, "amount")));
      case DRIVER_BALANCE_WARNING ->
          account(
              event,
              NotificationAudience.DRIVER,
              "Your balance is getting low",
              ("Your balance is %s, close to the limit of %s. Settle soon to keep receiving"
                      + " ride requests.")
                  .formatted(moneyEn(params, "balance"), moneyEn(params, "floor")),
              "رصيدك يقترب من الحد",
              "رصيدك %s وهو قريب من الحد %s. سوِّ رصيدك قريباً لتستمر في استقبال طلبات الرحلات."
                  .formatted(moneyAr(params, "balance"), moneyAr(params, "floor")));
      case DRIVER_BALANCE_BLOCKED ->
          account(
              event,
              NotificationAudience.DRIVER,
              "Ride requests paused",
              ("Your balance reached %s, at or below the limit of %s. Settle your balance to"
                      + " receive ride requests again.")
                  .formatted(moneyEn(params, "balance"), moneyEn(params, "floor")),
              "توقفت طلبات الرحلات",
              "وصل رصيدك إلى %s وهو عند الحد %s أو دونه. سوِّ رصيدك لتستقبل طلبات الرحلات من جديد."
                  .formatted(moneyAr(params, "balance"), moneyAr(params, "floor")));
      case DRIVER_BALANCE_UNBLOCKED ->
          account(
              event,
              NotificationAudience.DRIVER,
              "Ride requests resumed",
              ("Thanks for settling. Your balance is now %s and you can receive ride requests"
                      + " again.")
                  .formatted(moneyEn(params, "balance")),
              "عادت طلبات الرحلات",
              "شكراً لتسوية رصيدك. رصيدك الآن %s ويمكنك استقبال طلبات الرحلات من جديد."
                  .formatted(moneyAr(params, "balance")));
      case CHAT_MESSAGE -> chatMessage(params);
      case SOS_TRIGGERED -> sosTriggered(event, params);
      case ROLE_SUSPENDED -> roleSuspended(event, params);
      case ROLE_REACTIVATED -> roleReactivated(event, params);
      case ACCOUNT_SUSPENDED ->
          account(
              event,
              NotificationAudience.ALL,
              "Account suspended",
              "Your Labby account has been suspended. Reason: %s"
                  .formatted(text(params.get("note"))),
              "تم إيقاف حسابك",
              "تم إيقاف حسابك في لبي. السبب: %s".formatted(text(params.get("note"))));
      case ACCOUNT_REACTIVATED ->
          account(
              event,
              NotificationAudience.ALL,
              "Account active again",
              "Your Labby account is active again. Reason: %s".formatted(text(params.get("note"))),
              "أُعيد تفعيل حسابك",
              "أصبح حسابك في لبي فعّالاً من جديد. السبب: %s".formatted(text(params.get("note"))));
      case REPORT_RESOLVED -> reportResolved(event, params);
      case DRIVER_METRIC_WARNING -> metricWarning(event, params);
      case SCHEDULED_CLAIMED ->
          scheduled(
              event,
              NotificationAudience.RIDER,
              params,
              NotificationCategory.SCHEDULED,
              "Driver confirmed for your scheduled ride",
              "%s will pick you up on %s at %s."
                  .formatted(
                      text(params.get("driverName")),
                      text(params.get("pickupDate")),
                      text(params.get("pickupTime"))),
              "تم تأكيد سائق لرحلتك المجدولة",
              "سيقلّك %s يوم %s الساعة %s."
                  .formatted(
                      text(params.get("driverName")),
                      text(params.get("pickupDate")),
                      text(params.get("pickupTime"))));
      case SCHEDULED_RELEASED ->
          scheduled(
              event,
              NotificationAudience.RIDER,
              params,
              NotificationCategory.SCHEDULED,
              "Your scheduled ride needs a new driver",
              ("Your driver can no longer make your ride on %s at %s. It stays open for other"
                      + " drivers.")
                  .formatted(text(params.get("pickupDate")), text(params.get("pickupTime"))),
              "رحلتك المجدولة بحاجة إلى سائق جديد",
              "لم يعد بإمكان سائقك القيام برحلتك يوم %s الساعة %s. ستبقى الرحلة متاحة لسائقين آخرين."
                  .formatted(text(params.get("pickupDate")), text(params.get("pickupTime"))));
      case SCHEDULED_CLAIM_LOST ->
          scheduled(
              event,
              NotificationAudience.DRIVER,
              params,
              NotificationCategory.SCHEDULED,
              "Scheduled ride back on the board",
              ("Your active vehicle can't do the ride on %s at %s, so it went back to other"
                      + " drivers. This doesn't count as a cancellation.")
                  .formatted(text(params.get("pickupDate")), text(params.get("pickupTime"))),
              "عادت الرحلة المجدولة إلى اللوحة",
              "مركبتك الحالية لا تناسب الرحلة يوم %s الساعة %s، فعادت لسائقين آخرين. لا يُحتسب ذلك إلغاءً."
                  .formatted(text(params.get("pickupDate")), text(params.get("pickupTime"))));
      case SCHEDULED_REMINDER -> scheduledReminder(event, params);
      case SHARED_DISPATCHED, SHARED_CANCELLED, SHARED_MEMBER_NO_SHOW -> shared(event, params);
      case SCHEDULED_CONVERTED ->
          isDriver(params)
              ? scheduled(
                  event,
                  NotificationAudience.DRIVER,
                  params,
                  NotificationCategory.SCHEDULED,
                  "Your scheduled ride is live",
                  "Head to the pickup point for your scheduled ride.",
                  "رحلتك المجدولة بدأت",
                  "توجّه إلى نقطة الانطلاق لرحلتك المجدولة.")
              : scheduled(
                  event,
                  NotificationAudience.RIDER,
                  params,
                  NotificationCategory.SCHEDULED,
                  "Your driver is on the way",
                  "Your scheduled ride has started — your driver is heading to your pickup point.",
                  "سائقك في الطريق",
                  "بدأت رحلتك المجدولة — سائقك في طريقه إلى نقطة الانطلاق.");
      case SCHEDULED_CANCELLED_RIDER_BUSY ->
          isDriver(params)
              ? scheduled(
                  event,
                  NotificationAudience.DRIVER,
                  params,
                  NotificationCategory.RIDE,
                  "Scheduled ride cancelled",
                  "The rider of your scheduled ride is on another trip, so the ride was cancelled.",
                  "أُلغيت الرحلة المجدولة",
                  "راكب رحلتك المجدولة في رحلة أخرى، لذلك أُلغيت الرحلة.")
              : scheduled(
                  event,
                  NotificationAudience.RIDER,
                  params,
                  NotificationCategory.RIDE,
                  "Scheduled ride cancelled",
                  "You were on another ride when your scheduled ride was due, so we cancelled it."
                      + " You weren't charged.",
                  "أُلغيت رحلتك المجدولة",
                  "كنت في رحلة أخرى عند موعد رحلتك المجدولة، لذلك ألغيناها. لم تُحتسب عليك أي رسوم.");
    };
  }

  /** M12 shared rides: dispatch, group cancellation and a member's no-show (category ride). */
  private static Rendered shared(NotificationEvent event, Map<String, Object> params) {
    return switch (event) {
      case SHARED_DISPATCHED ->
          toRider(
              event,
              params,
              "Your shared ride is starting",
              "We're finding a driver for your shared ride now.",
              "رحلتك المشتركة تنطلق",
              "نبحث الآن عن سائق لرحلتك المشتركة.");
      case SHARED_CANCELLED -> {
        String reason = text(params.get("reason"));
        yield switch (reason) {
          case "expired" ->
              toRider(
                  event,
                  params,
                  "Shared ride cancelled",
                  "Your shared ride didn't fill up in time, so it was cancelled. You weren't"
                      + " charged.",
                  "أُلغيت الرحلة المشتركة",
                  "لم تكتمل مقاعد رحلتك المشتركة في الوقت المحدد، لذلك أُلغيت. لم تُحتسب عليك أي"
                      + " رسوم.");
          case "rider_busy" ->
              toRider(
                  event,
                  params,
                  "Shared ride cancelled",
                  "You were on another ride when your shared ride started, so it went ahead"
                      + " without you. You weren't charged.",
                  "أُلغيت الرحلة المشتركة",
                  "كنت في رحلة أخرى عند انطلاق رحلتك المشتركة، فانطلقت دونك. لم تُحتسب عليك أي"
                      + " رسوم.");
          case "creator_busy" ->
              toRider(
                  event,
                  params,
                  "Shared ride cancelled",
                  "The organizer couldn't take the shared ride you joined, so it was cancelled."
                      + " You weren't charged.",
                  "أُلغيت الرحلة المشتركة",
                  "تعذّر على منظّم الرحلة المشتركة التي انضممت إليها القيام بها، فأُلغيت. لم"
                      + " تُحتسب عليك أي رسوم.");
          case "account_suspended" ->
              toRider(
                  event,
                  params,
                  "Shared ride cancelled",
                  "The shared ride you joined was cancelled. You weren't charged.",
                  "أُلغيت الرحلة المشتركة",
                  "أُلغيت الرحلة المشتركة التي انضممت إليها. لم تُحتسب عليك أي رسوم.");
          default ->
              toRider(
                  event,
                  params,
                  "Shared ride cancelled",
                  "The organizer cancelled the shared ride you joined. You weren't charged.",
                  "أُلغيت الرحلة المشتركة",
                  "ألغى منظّم الرحلة المشتركة التي انضممت إليها الرحلة. لم تُحتسب عليك أي رسوم.");
        };
      }
      default -> {
        boolean charged = params.get("fee") != null;
        yield toRider(
            event,
            params,
            "Marked as not at pickup",
            charged
                ? "Your driver couldn't find you at the pickup point, so the ride went on without"
                    + " you. A cancellation fee of %s applies.".formatted(moneyEn(params, "fee"))
                : "Your driver couldn't find you at the pickup point, so the ride went on without"
                    + " you.",
            "لم يجدك السائق",
            charged
                ? "لم يجدك السائق عند نقطة الانطلاق، فواصلت الرحلة دونك. تُطبَّق رسوم إلغاء قدرها %s."
                    .formatted(moneyAr(params, "fee"))
                : "لم يجدك السائق عند نقطة الانطلاق، فواصلت الرحلة دونك.");
      }
    };
  }

  /** RIDE-S3: the 24 h / 1 h reminder, to the rider or the claiming driver (Western digits). */
  private static Rendered scheduledReminder(NotificationEvent event, Map<String, Object> params) {
    int minutes = number(params.get("minutesBefore"));
    String time = text(params.get("pickupTime"));
    if (isDriver(params)) {
      return scheduled(
          event,
          NotificationAudience.DRIVER,
          params,
          NotificationCategory.SCHEDULED,
          "Upcoming scheduled ride",
          "You have a pickup in %s, at %s. Be online before then.".formatted(leadEn(minutes), time),
          "رحلة مجدولة قادمة",
          "لديك رحلة بعد %s، الساعة %s. كن متصلاً قبل ذلك.".formatted(leadAr(minutes), time));
    }
    return scheduled(
        event,
        NotificationAudience.RIDER,
        params,
        NotificationCategory.SCHEDULED,
        "Upcoming ride",
        "Your scheduled ride is in %s, at %s.".formatted(leadEn(minutes), time),
        "رحلة قادمة",
        "رحلتك المجدولة بعد %s، الساعة %s.".formatted(leadAr(minutes), time));
  }

  private static boolean isDriver(Map<String, Object> params) {
    return "driver".equals(text(params.get("as")));
  }

  /** A lead like "1 hour", "24 hours", "45 minutes". */
  private static String leadEn(int minutes) {
    if (minutes % 60 == 0) {
      int hours = minutes / 60;
      return hours == 1 ? "1 hour" : hours + " hours";
    }
    return minutes == 1 ? "1 minute" : minutes + " minutes";
  }

  /** The Arabic lead with its number agreement (Western digits). */
  private static String leadAr(int minutes) {
    if (minutes % 60 == 0) {
      int hours = minutes / 60;
      if (hours == 1) {
        return "ساعة";
      }
      if (hours == 2) {
        return "ساعتين";
      }
      return hours <= 10 ? hours + " ساعات" : hours + " ساعة";
    }
    if (minutes == 1) {
      return "دقيقة";
    }
    if (minutes == 2) {
      return "دقيقتين";
    }
    return minutes <= 10 ? minutes + " دقائق" : minutes + " دقيقة";
  }

  /** A scheduled-ride notice with the {@code ride} deep link, to either app. */
  private static Rendered scheduled(
      NotificationEvent event,
      NotificationAudience audience,
      Map<String, Object> params,
      NotificationCategory category,
      String titleEn,
      String bodyEn,
      String titleAr,
      String bodyAr) {
    return new Rendered(
        category,
        audience,
        event.getValue(),
        titleEn,
        bodyEn,
        titleAr,
        bodyAr,
        SCREEN_RIDE,
        Map.of("rideId", text(params.get("rideId"))));
  }

  /**
   * USR-04/05/06: a role suspension, to that role's app. A low-rating suspension states the rule
   * that fired (Western digits in both languages); a manual one carries the admin's reason. No deep
   * link — a push tap opens the notification center.
   */
  private static Rendered roleSuspended(NotificationEvent event, Map<String, Object> params) {
    boolean driver = "driver".equals(text(params.get("role")));
    String titleEn = driver ? "Driver account suspended" : "Rider account suspended";
    String titleAr = driver ? "تم إيقاف حساب السائق" : "تم إيقاف حساب الراكب";
    String roleEn = driver ? "driver" : "rider";
    String roleAr = driver ? "السائق" : "الراكب";
    String bodyEn;
    String bodyAr;
    if (SuspensionReason.LOW_RATING.getValue().equals(text(params.get("reason")))) {
      String level = text(params.get("minAvgRating"));
      int rides = number(params.get("minRatedRides"));
      bodyEn =
          "Your %s account is suspended because your average rating is below %s after %s."
              .formatted(roleEn, level, ratedRidesEn(rides));
      bodyAr =
          "تم إيقاف حساب %s الخاص بك لأن متوسط تقييمك أقل من %s بعد %s."
              .formatted(roleAr, level, ratedRidesAr(rides));
    } else {
      bodyEn =
          "Your %s account has been suspended. Reason: %s"
              .formatted(roleEn, text(params.get("note")));
      bodyAr = "تم إيقاف حساب %s الخاص بك. السبب: %s".formatted(roleAr, text(params.get("note")));
    }
    return account(
        event,
        driver ? NotificationAudience.DRIVER : NotificationAudience.RIDER,
        titleEn,
        bodyEn,
        titleAr,
        bodyAr);
  }

  /** USR-06: an admin lifted a role suspension, with the admin's reason. */
  private static Rendered roleReactivated(NotificationEvent event, Map<String, Object> params) {
    boolean driver = "driver".equals(text(params.get("role")));
    return account(
        event,
        driver ? NotificationAudience.DRIVER : NotificationAudience.RIDER,
        driver ? "Driver account active again" : "Rider account active again",
        "Your %s account is active again. Reason: %s"
            .formatted(driver ? "driver" : "rider", text(params.get("note"))),
        driver ? "أُعيد تفعيل حساب السائق" : "أُعيد تفعيل حساب الراكب",
        "أصبح حساب %s الخاص بك فعّالاً من جديد. السبب: %s"
            .formatted(driver ? "السائق" : "الراكب", text(params.get("note"))));
  }

  /** REP-02: the outcome of the reporter's report — never the internal notes. */
  private static Rendered reportResolved(NotificationEvent event, Map<String, Object> params) {
    boolean substantiated = "substantiated".equals(text(params.get("outcome")));
    boolean driver = "driver".equals(text(params.get("role")));
    return account(
        event,
        driver ? NotificationAudience.DRIVER : NotificationAudience.RIDER,
        "Your report was reviewed",
        substantiated
            ? "We reviewed your report and confirmed it. Thank you for helping keep Labby safe."
            : "We reviewed your report but could not confirm it. Thank you for letting us know.",
        "تمت مراجعة بلاغك",
        substantiated
            ? "راجعنا بلاغك وتأكدنا من صحته. شكراً لمساعدتك في الحفاظ على أمان لبي."
            : "راجعنا بلاغك ولم نتمكن من تأكيده. شكراً لإبلاغنا.");
  }

  /** DRV-07: a metric warning with the rule that raised it (warn only — never a suspension). */
  private static Rendered metricWarning(NotificationEvent event, Map<String, Object> params) {
    boolean acceptance = "acceptance".equals(text(params.get("metric")));
    String value = percent(params.get("valuePercent"));
    String threshold = percent(params.get("thresholdPercent"));
    int days = number(params.get("windowDays"));
    return account(
        event,
        NotificationAudience.DRIVER,
        acceptance ? "Your acceptance rate is low" : "Your cancellation rate is high",
        acceptance
            ? ("Your acceptance rate for the last %s is %s, below the %s minimum. Try to accept"
                    + " more ride requests.")
                .formatted(daysEn(days), value, threshold)
            : ("Your cancellation rate for the last %s is %s, above the %s maximum. Try to"
                    + " cancel fewer accepted rides.")
                .formatted(daysEn(days), value, threshold),
        acceptance ? "معدل قبولك منخفض" : "معدل إلغائك مرتفع",
        acceptance
            ? "معدل قبولك للطلبات خلال آخر %s هو %s، وهو أقل من الحد الأدنى %s. حاول قبول المزيد من طلبات الرحلات."
                .formatted(daysAr(days), value, threshold)
            : "معدل إلغائك للرحلات خلال آخر %s هو %s، وهو أعلى من الحد الأقصى %s. حاول تقليل إلغاء الرحلات التي قبلتها."
                .formatted(daysAr(days), value, threshold));
  }

  /** A percent param as plain text with Western digits: {@code 42.5%}, {@code 50%}. */
  private static String percent(Object value) {
    try {
      return new BigDecimal(text(value)).stripTrailingZeros().toPlainString() + "%";
    } catch (NumberFormatException ex) {
      return text(value) + "%";
    }
  }

  private static String ratedRidesEn(int rides) {
    return rides == 1 ? "1 rated ride" : rides + " rated rides";
  }

  /** Arabic number–noun agreement for "rated rides". */
  static String ratedRidesAr(int rides) {
    if (rides == 1) {
      return "رحلة مقيّمة واحدة";
    }
    if (rides == 2) {
      return "رحلتين مقيّمتين";
    }
    if (rides >= 3 && rides <= 10) {
      return rides + " رحلات مقيّمة";
    }
    return rides + " رحلة مقيّمة";
  }

  /**
   * CHAT-02: the new-message push to its recipient's party app, deep-linked into the ride's chat.
   * Message content never rides in the push — only who sent it.
   */
  private static Rendered chatMessage(Map<String, Object> params) {
    String sender = text(params.get("senderName"));
    boolean toDriver = "driver".equals(text(params.get("recipientRole")));
    return new Rendered(
        NotificationCategory.CHAT,
        toDriver ? NotificationAudience.DRIVER : NotificationAudience.RIDER,
        NotificationEvent.CHAT_MESSAGE.getValue(),
        "New message",
        "You have a new message from %s. Open the chat to reply.".formatted(sender),
        "رسالة جديدة",
        "لديك رسالة جديدة من %s. افتح المحادثة للرد.".formatted(sender),
        SCREEN_CHAT,
        params.get("memberId") == null
            ? Map.of("rideId", text(params.get("rideId")))
            : Map.of(
                "rideId", text(params.get("rideId")), "memberId", text(params.get("memberId"))));
  }

  /**
   * SAFE-01: the SOS alert to support admins (category {@code safety} — never muted). The admin
   * dashboard has no deep-link screen catalog, so a push tap opens the notification center.
   */
  private static Rendered sosTriggered(NotificationEvent event, Map<String, Object> params) {
    boolean driver = "driver".equals(text(params.get("role")));
    return new Rendered(
        NotificationCategory.SAFETY,
        NotificationAudience.ADMIN,
        event.getValue(),
        "SOS alert",
        "A %s triggered SOS during a ride. Open the live ops map now."
            .formatted(driver ? "driver" : "rider"),
        "تنبيه استغاثة",
        "أطلق %s إشارة استغاثة أثناء رحلة. افتح خريطة العمليات المباشرة الآن."
            .formatted(driver ? "سائق" : "راكب"),
        null,
        Map.of());
  }

  /**
   * PAY-02: the completion push says how the fare was (or is to be) paid — fully from the wallet,
   * wallet + cash remainder, or cash — and itemizes the carried cancellation fees (M8 re-audit
   * R-W1): {@code carriedWallet} taken from the wallet, {@code carriedCash} included in the cash.
   */
  private static Rendered completed(NotificationEvent event, Map<String, Object> params) {
    String cashDue = text(params.get("cashDue"));
    boolean wallet = "wallet".equals(text(params.get("method")));
    boolean carriedWallet = !text(params.get("carriedWallet")).isEmpty();
    boolean carriedCash = !text(params.get("carriedCash")).isEmpty();
    String totalEn = moneyEn(params, "total");
    String totalAr = moneyAr(params, "total");
    String bodyEn;
    String bodyAr;
    if (wallet && cashDue.isEmpty()) {
      bodyEn =
          carriedWallet
              ? ("Your fare is %s. It was paid from your wallet, together with %s in carried"
                      + " cancellation fees.")
                  .formatted(totalEn, moneyEn(params, "carriedWallet"))
              : "Your fare is %s. It was paid from your wallet.".formatted(totalEn);
      bodyAr =
          carriedWallet
              ? "أجرة رحلتك %s. تم دفعها من محفظتك مع %s من رسوم الإلغاء المستحقة عليك."
                  .formatted(totalAr, moneyAr(params, "carriedWallet"))
              : "أجرة رحلتك %s. تم دفعها من محفظتك.".formatted(totalAr);
    } else if (wallet) {
      bodyEn =
          "Your fare is %s. Your wallet covered %s — please pay your driver %s in cash"
                  .formatted(totalEn, moneyEn(params, "walletApplied"), moneyEn(params, "cashDue"))
              + (carriedCash
                  ? " (includes %s in carried cancellation fees)"
                      .formatted(moneyEn(params, "carriedCash"))
                  : "")
              + "."
              + (carriedWallet
                  ? " Your wallet also paid %s in carried cancellation fees."
                      .formatted(moneyEn(params, "carriedWallet"))
                  : "");
      bodyAr =
          "أجرة رحلتك %s. غطت محفظتك %s، يرجى دفع %s للسائق نقداً"
                  .formatted(totalAr, moneyAr(params, "walletApplied"), moneyAr(params, "cashDue"))
              + (carriedCash
                  ? " (تشمل %s من رسوم الإلغاء المستحقة عليك)"
                      .formatted(moneyAr(params, "carriedCash"))
                  : "")
              + "."
              + (carriedWallet
                  ? " ودفعت محفظتك أيضاً %s من رسوم الإلغاء المستحقة عليك."
                      .formatted(moneyAr(params, "carriedWallet"))
                  : "");
    } else if (carriedCash) {
      bodyEn =
          "Your fare is %s. Please pay your driver %s in cash (includes %s in carried cancellation fees)."
              .formatted(totalEn, moneyEn(params, "cashDue"), moneyEn(params, "carriedCash"));
      bodyAr =
          "أجرة رحلتك %s. يرجى دفع %s للسائق نقداً (تشمل %s من رسوم الإلغاء المستحقة عليك)."
              .formatted(totalAr, moneyAr(params, "cashDue"), moneyAr(params, "carriedCash"));
    } else if (!cashDue.isEmpty()) {
      bodyEn =
          "Your fare is %s. With your carried fees, please pay your driver %s in cash."
              .formatted(totalEn, moneyEn(params, "cashDue"));
      bodyAr =
          "أجرة رحلتك %s. مع الرسوم المستحقة عليك، يرجى دفع %s للسائق نقداً."
              .formatted(totalAr, moneyAr(params, "cashDue"));
    } else {
      bodyEn = "Your fare is %s. Please pay your driver in cash.".formatted(totalEn);
      bodyAr = "أجرة رحلتك %s. يرجى الدفع للسائق نقداً.".formatted(totalAr);
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
                      + " cancellation fee of %s applies.")
                  .formatted(moneyEn(params, "fee"))
              : "Your driver waited but couldn't find you, so the ride was cancelled.",
          "أُلغيت الرحلة",
          charged
              ? "انتظرك السائق ولم يجدك، فأُلغيت الرحلة. تُطبَّق رسوم إلغاء قدرها %s."
                  .formatted(moneyAr(params, "fee"))
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

  /** A money param in English, formatted for the params' currency (W8). */
  private static String moneyEn(Map<String, Object> params, String key) {
    return MoneyFormat.en(params.get(key), text(params.get("currency")));
  }

  /** A money param in Arabic, formatted for the params' currency (W8). */
  private static String moneyAr(Map<String, Object> params, String key) {
    return MoneyFormat.ar(params.get(key), text(params.get("currency")));
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
