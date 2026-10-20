package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;

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
}
