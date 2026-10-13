package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.dto.ThresholdStepDto;
import com.labby.backend.service.SurgeCalculator;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * PRC-02 surge math: ratio → threshold step with exact boundaries (SRS defaults ≥2 → 1.2, ≥3 → 1.5,
 * ≥5 → 2.0), no demand → 1.00, demand without supply → top step, the lower of zone and region cap
 * binds, steps in any stored order; plus the heatmap level and the next-cycle time.
 */
class SurgeCalculatorTest {

  private static final List<ThresholdStepDto> DEFAULT_STEPS =
      List.of(step("2", "1.2"), step("3", "1.5"), step("5", "2.0"));

  private final SurgeCalculator calculator = new SurgeCalculator();

  private static ThresholdStepDto step(String ratio, String multiplier) {
    return new ThresholdStepDto(new BigDecimal(ratio), new BigDecimal(multiplier));
  }

  @ParameterizedTest(name = "demand {0} / supply {1} -> {2}")
  @CsvSource({
    "199, 100, 1.00", // 1.99
    "200, 100, 1.20", // 2.00 boundary
    "299, 100, 1.20", // 2.99
    "300, 100, 1.50", // 3.00 boundary
    "499, 100, 1.50", // 4.99
    "500, 100, 2.00", // 5.00 boundary
    "100000, 1, 2.00", // huge
    "1, 1, 1.00",
    "2, 3, 1.00" // 0.67 — no step reached
  })
  @DisplayName("PRC-02: the highest step the ratio reaches, boundaries inclusive")
  void shouldMapRatioToStep(long demand, long supply, String expected) {
    assertThat(calculator.computed(DEFAULT_STEPS, demand, supply, null, null))
        .isEqualByComparingTo(expected);
  }

  @Test
  @DisplayName("PRC-02: no demand is no surge, even without supply")
  void shouldNotSurgeWithoutDemand() {
    assertThat(calculator.computed(DEFAULT_STEPS, 0, 0, null, null)).isEqualByComparingTo("1.00");
    assertThat(calculator.computed(DEFAULT_STEPS, 0, 7, null, null)).isEqualByComparingTo("1.00");
  }

  @Test
  @DisplayName("PRC-02: demand without supply takes the top step")
  void shouldTakeTopStepWithoutSupply() {
    assertThat(calculator.computed(DEFAULT_STEPS, 1, 0, null, null)).isEqualByComparingTo("2.00");
  }

  @Test
  @DisplayName("PRC-02: the lower of zone cap and region cap binds; null caps never limit")
  void shouldApplyTheLowerCap() {
    BigDecimal zoneCap = new BigDecimal("1.30");
    BigDecimal regionCap = new BigDecimal("1.80");
    assertThat(calculator.computed(DEFAULT_STEPS, 10, 1, zoneCap, regionCap))
        .isEqualByComparingTo("1.30");
    assertThat(calculator.computed(DEFAULT_STEPS, 10, 1, regionCap, zoneCap))
        .isEqualByComparingTo("1.30");
    assertThat(calculator.computed(DEFAULT_STEPS, 10, 1, null, regionCap))
        .isEqualByComparingTo("1.80");
    assertThat(calculator.computed(DEFAULT_STEPS, 10, 1, zoneCap, null))
        .isEqualByComparingTo("1.30");
    assertThat(calculator.computed(DEFAULT_STEPS, 10, 1, null, null)).isEqualByComparingTo("2.00");
    // A cap above the reached step changes nothing.
    assertThat(calculator.computed(DEFAULT_STEPS, 3, 1, new BigDecimal("3.00"), null))
        .isEqualByComparingTo("1.50");
    assertThat(calculator.effectiveCap(null, null)).isNull();
  }

  @Test
  @DisplayName("UC-A-09: the override wins over the computed value, clamped to the binding cap")
  void shouldClampOverrideToCap() {
    BigDecimal computed = new BigDecimal("1.20");
    assertThat(calculator.current(null, computed, new BigDecimal("1.30"), null))
        .isEqualByComparingTo("1.20");
    assertThat(calculator.current(new BigDecimal("1.50"), computed, null, null))
        .isEqualByComparingTo("1.50");
    assertThat(calculator.current(new BigDecimal("1.50"), computed, new BigDecimal("1.30"), null))
        .isEqualByComparingTo("1.30");
    assertThat(calculator.current(new BigDecimal("1.50"), computed, null, new BigDecimal("1.40")))
        .isEqualByComparingTo("1.40");
    assertThat(
            calculator.current(
                new BigDecimal("1.10"), computed, new BigDecimal("1.30"), new BigDecimal("2.00")))
        .isEqualByComparingTo("1.10");
  }

  @Test
  @DisplayName("PRC-02: stored steps are evaluated in ratio order whatever the JSON order")
  void shouldOrderUnorderedSteps() {
    List<ThresholdStepDto> unordered =
        List.of(step("5", "2.0"), step("2", "1.2"), step("3", "1.5"));
    assertThat(calculator.computed(unordered, 3, 1, null, null)).isEqualByComparingTo("1.50");
    assertThat(calculator.computed(unordered, 2, 1, null, null)).isEqualByComparingTo("1.20");
    assertThat(calculator.computed(unordered, 1, 0, null, null)).isEqualByComparingTo("2.00");
    assertThat(calculator.level(unordered, new BigDecimal("1.50"))).isEqualTo(2);
  }

  @Test
  @DisplayName("DRV-09: level = highest step whose multiplier the current value reaches")
  void shouldMapMultiplierToLevel() {
    assertThat(calculator.level(DEFAULT_STEPS, new BigDecimal("1.00"))).isZero();
    assertThat(calculator.level(DEFAULT_STEPS, new BigDecimal("1.10"))).isZero();
    assertThat(calculator.level(DEFAULT_STEPS, new BigDecimal("1.20"))).isEqualTo(1);
    assertThat(calculator.level(DEFAULT_STEPS, new BigDecimal("1.70"))).isEqualTo(2);
    assertThat(calculator.level(DEFAULT_STEPS, new BigDecimal("2.00"))).isEqualTo(3);
    assertThat(calculator.level(DEFAULT_STEPS, new BigDecimal("2.50"))).isEqualTo(3);
  }

  @Test
  @DisplayName("The next cycle follows the cron; a disabled cron has none")
  void shouldComputeNextFire() {
    Instant now = Instant.parse("2026-10-13T10:01:30Z");
    assertThat(calculator.nextFire("0 */2 * * * *", now))
        .isEqualTo(Instant.parse("2026-10-13T10:02:00Z"));
    assertThat(calculator.nextFire("-", now)).isNull();
  }
}
