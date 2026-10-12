package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.model.Region;
import com.labby.backend.service.CommissionPolicy;
import com.labby.backend.service.CommissionPolicy.Tier;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * COM-02 tier resolution: "above" is strictly greater, the highest exceeded threshold wins, no
 * exceeded tier means the base tier; commission amounts round HALF_UP to 2 decimals; weeks start
 * Monday in the region's time zone.
 */
class CommissionPolicyTest {

  private final CommissionPolicy policy = new CommissionPolicy();
  private final List<Tier> defaults = CommissionPolicy.DEFAULT_TIERS;

  @Test
  @DisplayName("the SRS default tiers resolve 25 / 20 above 100 / 15 above 200, strictly greater")
  void shouldResolveDefaultTierBoundaries() {
    assertThat(policy.percentFor(0, defaults)).isEqualByComparingTo("25");
    assertThat(policy.percentFor(99, defaults)).isEqualByComparingTo("25");
    assertThat(policy.percentFor(100, defaults)).isEqualByComparingTo("25");
    assertThat(policy.percentFor(101, defaults)).isEqualByComparingTo("20");
    assertThat(policy.percentFor(199, defaults)).isEqualByComparingTo("20");
    assertThat(policy.percentFor(200, defaults)).isEqualByComparingTo("20");
    assertThat(policy.percentFor(201, defaults)).isEqualByComparingTo("15");
    assertThat(policy.percentFor(5000, defaults)).isEqualByComparingTo("15");
  }

  @Test
  @DisplayName("a region's configured tiers override the defaults and are sorted by threshold")
  void shouldUseRegionTiers() {
    Region region =
        Region.builder()
            .commissionTiers(
                List.of(
                    Map.of("weeklyTripsAbove", 50, "percent", 18),
                    Map.of("weeklyTripsAbove", 0, "percent", 30)))
            .build();
    List<Tier> tiers = policy.tiers(region);
    assertThat(policy.baseTier(tiers).percent()).isEqualByComparingTo("30");
    assertThat(policy.percentFor(50, tiers)).isEqualByComparingTo("30");
    assertThat(policy.percentFor(51, tiers)).isEqualByComparingTo("18");
    // No tiers configured → SRS defaults.
    assertThat(policy.tiers(Region.builder().build())).isEqualTo(defaults);
  }

  @Test
  @DisplayName("the next tier reflects the CURRENT week's trips: reached only when strictly above")
  void shouldComputeNextTier() {
    assertThat(policy.nextTier(0, defaults)).contains(new Tier(100, new BigDecimal("20")));
    assertThat(policy.nextTier(100, defaults)).contains(new Tier(100, new BigDecimal("20")));
    assertThat(policy.nextTier(101, defaults)).contains(new Tier(200, new BigDecimal("15")));
    assertThat(policy.nextTier(200, defaults)).contains(new Tier(200, new BigDecimal("15")));
    assertThat(policy.nextTier(201, defaults)).isEmpty();
  }

  @Test
  @DisplayName("commission amounts round HALF_UP to 2 decimals (owner ruling 2026-10-11)")
  void shouldRoundCommissionHalfUp() {
    assertThat(CommissionPolicy.commission(new BigDecimal("1.50"), new BigDecimal("25")))
        .isEqualTo(new BigDecimal("0.38")); // 0.375 rounds up
    assertThat(CommissionPolicy.commission(new BigDecimal("1.49"), new BigDecimal("25")))
        .isEqualTo(new BigDecimal("0.37")); // 0.3725 rounds down
    assertThat(CommissionPolicy.commission(new BigDecimal("10.00"), new BigDecimal("20")))
        .isEqualTo(new BigDecimal("2.00"));
    assertThat(CommissionPolicy.commission(new BigDecimal("0.01"), new BigDecimal("15")))
        .isEqualTo(new BigDecimal("0.00")); // 0.0015 → 0.00 at 2 decimals
  }

  @Test
  @DisplayName("weeks start Monday in the region's time zone")
  void shouldComputeMondayWeekStart() {
    ZoneId damascus = ZoneId.of("Asia/Damascus");
    // Sunday 2026-10-11 23:30 UTC is Monday 2026-10-12 02:30 in Damascus (+3).
    assertThat(CommissionPolicy.weekStart(Instant.parse("2026-10-11T23:30:00Z"), damascus))
        .isEqualTo(LocalDate.parse("2026-10-12"));
    assertThat(CommissionPolicy.weekStart(Instant.parse("2026-10-11T12:00:00Z"), damascus))
        .isEqualTo(LocalDate.parse("2026-10-05"));
    assertThat(CommissionPolicy.weekStart(Instant.parse("2026-10-18T20:59:00Z"), damascus))
        .isEqualTo(LocalDate.parse("2026-10-12"));
  }
}
