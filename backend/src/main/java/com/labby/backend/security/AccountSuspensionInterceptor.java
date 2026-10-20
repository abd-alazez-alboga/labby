package com.labby.backend.security;

import com.labby.backend.enums.RideParty;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.service.SuspensionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.lang.NonNull;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * USR-06 whole-account suspension (M11, trust-v1.yaml): every rider/driver feature answers 403
 * {@code account_suspended} while the account is suspended — one central gate on the feature paths
 * ({@link #FEATURE_PATHS}) instead of a check per service. Login, the profile, notifications and
 * devices stay reachable so the apps can show the suspended screen with the admin's note.
 *
 * <p>Owner ruling 2026-10-15, "SOS + finish the ride": a suspended account may still
 *
 * <ul>
 *   <li>trigger SOS on any ride ({@code POST /rides/{id}/sos} — the party check stays in the
 *       service);
 *   <li>read its in-flight ride ({@code GET /rides/active}, {@code GET /driver/rides/active});
 *   <li>as the RIDER of an in-flight ride (accepted / driver_arrived / in_progress): {@code GET
 *       /rides/{id}}, {@code GET /rides/{id}/cancellation-quote}, {@code POST /rides/{id}/cancel},
 *       {@code PUT /rides/{id}/route};
 *   <li>as the DRIVER of an in-flight ride: {@code GET /driver/rides/{id}}, {@code POST
 *       /driver/rides/{id}/arrive|start|complete|cancel}, and {@code POST /driver/locations} and
 *       {@code GET /driver/availability} (cold-start resume of the GPS stream) while driving one;
 *       after completion with the cash payment still pending: {@code GET /driver/rides/{id}},
 *       {@code POST /driver/rides/{id}/cash-confirm|mark-unpaid};
 *   <li>as either party of an in-flight ride: its chat ({@code GET /rides/{id}/chat}, {@code GET
 *       /rides/{id}/chat/messages}, {@code POST /rides/{id}/chat/read}), and while it has one,
 *       {@code GET /chat/quick-replies} and {@code POST /routing/route}.
 * </ul>
 *
 * Everything else — booking and estimates, scheduling, creating / joining / starting shared rides
 * (review V1 C1), availability, offers, wallet, ratings, reports, chat of other rides — stays
 * refused. Deliberately NOT a {@code @Component}: like {@link JwtAuthFilter}, it is built and
 * registered only by the MVC config.
 */
@RequiredArgsConstructor
public class AccountSuspensionInterceptor implements HandlerInterceptor {

  /**
   * The rider/driver feature endpoints (rides-v1, money-v1, comms-v1, trust-v1, onboarding-v1,
   * scheduled-shared-v1).
   */
  public static final List<String> FEATURE_PATHS =
      List.of(
          "/api/v1/rides/**",
          "/api/v1/scheduled-rides/**",
          "/api/v1/shared-rides/**",
          "/api/v1/rider/**",
          "/api/v1/driver/**",
          "/api/v1/wallet/**",
          "/api/v1/chat/**",
          "/api/v1/routing/**",
          "/api/v1/ratings/**",
          "/api/v1/reports/**",
          "/api/v1/report-files/**");

  private static final String ID = "([0-9a-fA-F-]{36})";
  private static final Pattern SOS = Pattern.compile("/api/v1/rides/" + ID + "/sos");
  private static final Pattern RIDER_RIDE =
      Pattern.compile("/api/v1/rides/" + ID + "(/cancellation-quote|/cancel|/route)?");
  private static final Pattern SHARED_RIDE =
      Pattern.compile("/api/v1/shared-rides/" + ID + "(/leave-quote|/leave)?");
  private static final Pattern CHAT =
      Pattern.compile("/api/v1/rides/" + ID + "/chat(/messages|/read)?");
  private static final Pattern DRIVER_RIDE = Pattern.compile("/api/v1/driver/rides/" + ID);
  private static final Pattern DRIVER_ACTION =
      Pattern.compile("/api/v1/driver/rides/" + ID + "/(arrive|start|complete|cancel)");
  private static final Pattern DRIVER_PAYMENT =
      Pattern.compile("/api/v1/driver/rides/" + ID + "/(cash-confirm|mark-unpaid)");

  private final SuspensionService suspensionService;

  @Override
  public boolean preHandle(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull Object handler) {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication != null
        && authentication.getDetails() instanceof JwtService.AccessClaims claims
        && suspensionService.isAccountSuspended(claims.userId())
        && !finishingARide(claims.userId(), request.getMethod(), request.getRequestURI())) {
      throw new ForbiddenException("Your account is suspended").withCode("account_suspended");
    }
    return true;
  }

  /** The owner-ruled exemption (see the class comment). */
  private boolean finishingARide(UUID userId, String method, String path) {
    boolean get = "GET".equals(method);
    boolean post = "POST".equals(method);
    Matcher matcher;
    if (post && SOS.matcher(path).matches()) {
      return true;
    }
    if (get
        && ("/api/v1/rides/active".equals(path) || "/api/v1/driver/rides/active".equals(path))) {
      return true;
    }
    if ((matcher = RIDER_RIDE.matcher(path)).matches()) {
      String tail = matcher.group(2);
      boolean allowedMethod =
          tail == null || "/cancellation-quote".equals(tail)
              ? get
              : "/cancel".equals(tail) ? post : "PUT".equals(method);
      return allowedMethod && rideParty(userId, matcher.group(1), RideParty.RIDER);
    }
    if ((matcher = SHARED_RIDE.matcher(path)).matches()) {
      // A member finishing an in-flight shared ride: its view, and leaving it (the shared-ride
      // cancel). Before dispatch nothing is in flight, so browse / join / start stay refused.
      boolean allowedMethod = "/leave".equals(matcher.group(2)) ? post : get;
      return allowedMethod && rideParty(userId, matcher.group(1), RideParty.RIDER);
    }
    if ((matcher = CHAT.matcher(path)).matches()) {
      boolean allowedMethod = "/read".equals(matcher.group(2)) ? post : get;
      return allowedMethod && rideParty(userId, matcher.group(1), null);
    }
    if (get && (matcher = DRIVER_RIDE.matcher(path)).matches()) {
      UUID rideId = UUID.fromString(matcher.group(1));
      return suspensionService.isActiveRideParty(userId, rideId, RideParty.DRIVER)
          || suspensionService.isAwaitingPayment(userId, rideId);
    }
    if (post && (matcher = DRIVER_ACTION.matcher(path)).matches()) {
      return rideParty(userId, matcher.group(1), RideParty.DRIVER);
    }
    if (post && (matcher = DRIVER_PAYMENT.matcher(path)).matches()) {
      return suspensionService.isAwaitingPayment(userId, UUID.fromString(matcher.group(1)));
    }
    if ((post && "/api/v1/driver/locations".equals(path))
        || (get && "/api/v1/driver/availability".equals(path))) {
      // Streaming the ride's GPS, and reading availability on a cold start to resume it.
      return suspensionService.hasActiveRide(userId, RideParty.DRIVER);
    }
    if ((get && "/api/v1/chat/quick-replies".equals(path))
        || (post && "/api/v1/routing/route".equals(path))) {
      return suspensionService.hasActiveRide(userId, null);
    }
    return false;
  }

  private boolean rideParty(UUID userId, String rideId, RideParty side) {
    return suspensionService.isActiveRideParty(userId, UUID.fromString(rideId), side);
  }
}
