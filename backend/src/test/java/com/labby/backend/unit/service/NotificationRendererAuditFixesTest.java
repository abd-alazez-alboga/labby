package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.service.NotificationRenderer;
import com.labby.backend.service.NotificationRenderer.Rendered;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The V1 conformance audit (2026-10-20) copy fixes of {@link NotificationRenderer}. */
class NotificationRendererAuditFixesTest {

  private final NotificationRenderer renderer = new NotificationRenderer();

  @Test
  @DisplayName("W29: a zero-total completion says there is nothing to pay, never 'pay in cash'")
  void shouldSayNothingToPayOnZeroTotal() {
    Rendered rendered =
        renderer
            .render(
                "ride.completed",
                Map.of("rideId", "r", "total", "0.00", "currency", "SYP", "method", "cash"))
            .orElseThrow();
    assertThat(rendered.bodyEn()).contains("nothing to pay").doesNotContain("cash");
    assertThat(rendered.bodyAr()).contains("لا يوجد ما تدفعه").doesNotContain("نقداً");
    // A zero total that still carries a cash due asks for that cash.
    Rendered withDue =
        renderer
            .render(
                "ride.completed",
                Map.of(
                    "rideId", "r",
                    "total", "0.00",
                    "currency", "SYP",
                    "method", "cash",
                    "cashDue", "2.00",
                    "carriedCash", "2.00"))
            .orElseThrow();
    assertThat(withDue.bodyEn()).contains("in cash");
  }

  @Test
  @DisplayName("W42/W22: a system release tells the driver the time, rider and the consequence")
  void shouldRenderDriverReleaseNotices() {
    Map<String, Object> params =
        new java.util.HashMap<>(
            Map.of(
                "rideId", "r-1",
                "pickupDate", "2026-10-21",
                "pickupTime", "09:00",
                "riderFirstName", "Rana",
                "as", "driver",
                "reason", "unavailable",
                "countsAsRelease", "true"));
    Rendered unavailable = renderer.render("scheduled.released", params).orElseThrow();
    assertThat(unavailable.audience()).isEqualTo(NotificationAudience.DRIVER);
    assertThat(unavailable.titleEn()).isEqualTo("Your 09:00 claim was released");
    assertThat(unavailable.bodyEn()).contains("2026-10-21", "It counts as a release");
    assertThat(unavailable.bodyAr()).contains("09:00", "يُحتسب");
    assertThat(unavailable.linkParams())
        .containsEntry("rideId", "r-1")
        .containsEntry("pickupTime", "09:00")
        .containsEntry("riderFirstName", "Rana")
        .containsEntry("countsAsRelease", "true");

    params.put("reason", "balance_below_floor");
    params.put("countsAsRelease", "false");
    Rendered floor = renderer.render("scheduled.released", params).orElseThrow();
    assertThat(floor.bodyEn()).contains("balance", "doesn't count");
    assertThat(floor.linkParams()).containsEntry("reason", "balance_below_floor");

    // The rider's copy is unchanged (no `as`).
    Rendered rider =
        renderer
            .render(
                "scheduled.released",
                Map.of("rideId", "r-1", "pickupDate", "2026-10-21", "pickupTime", "09:00"))
            .orElseThrow();
    assertThat(rider.audience()).isEqualTo(NotificationAudience.RIDER);

    Rendered busy = renderer.render("scheduled.cancelled_rider_busy", params).orElseThrow();
    assertThat(busy.bodyEn()).contains("Rana", "09:00");
    assertThat(busy.bodyAr()).contains("Rana", "09:00");
  }

  @Test
  @DisplayName("W40: the ETA delay notice is bilingual, ride category, with Arabic agreement")
  void shouldRenderEtaDelay() {
    Rendered pickup =
        renderer
            .render(
                "ride.eta_delayed", Map.of("rideId", "r", "etaMinutes", "12", "phase", "pickup"))
            .orElseThrow();
    assertThat(pickup.category()).isEqualTo(com.labby.backend.enums.NotificationCategory.RIDE);
    assertThat(pickup.audience()).isEqualTo(NotificationAudience.RIDER);
    assertThat(pickup.titleEn()).isEqualTo("Your driver is delayed");
    assertThat(pickup.bodyEn()).contains("12 minutes");
    assertThat(pickup.bodyAr()).contains("12 دقيقة");
    assertThat(pickup.linkParams()).containsEntry("rideId", "r");
    Rendered trip =
        renderer
            .render(
                "ride.eta_delayed",
                Map.of("rideId", "r", "etaMinutes", "7", "phase", "destination"))
            .orElseThrow();
    assertThat(trip.titleEn()).isEqualTo("Your arrival is delayed");
    assertThat(trip.bodyAr()).contains("7 دقائق");
  }
}
