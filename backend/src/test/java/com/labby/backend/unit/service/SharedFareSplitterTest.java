package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.service.SharedFareSplitter;
import com.labby.backend.service.SharedFareSplitter.Party;
import com.labby.backend.service.SharedFareSplitter.Split;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** RIDE-P4 per-seat math (scheduled-shared-v1, approved readings 2026-10-16). */
class SharedFareSplitterTest {

  private static final UUID CREATOR = UUID.randomUUID();
  private static final UUID SECOND = UUID.randomUUID();
  private static final UUID THIRD = UUID.randomUUID();

  @Test
  @DisplayName("an even split gives each party its seats' worth")
  void shouldSplitEvenly() {
    Split split =
        SharedFareSplitter.split(
            new BigDecimal("12.00"),
            List.of(new Party(CREATOR, 1, true), new Party(SECOND, 2, false)));
    assertThat(split.boardedSeats()).isEqualTo(3);
    assertThat(split.perSeatAmount()).isEqualByComparingTo("4.00");
    assertThat(split.shares().get(CREATOR)).isEqualByComparingTo("4.00");
    assertThat(split.shares().get(SECOND)).isEqualByComparingTo("8.00");
  }

  @Test
  @DisplayName("the rounding remainder goes to the creator; shares always sum to the fare")
  void shouldGiveRemainderToCreator() {
    Split split =
        SharedFareSplitter.split(
            new BigDecimal("10.00"),
            List.of(
                new Party(SECOND, 1, false),
                new Party(CREATOR, 1, true),
                new Party(THIRD, 1, false)));
    assertThat(split.perSeatAmount()).isEqualByComparingTo("3.33");
    assertThat(split.shares().get(CREATOR)).isEqualByComparingTo("3.34");
    assertThat(split.shares().get(SECOND)).isEqualByComparingTo("3.33");
    assertThat(sum(split)).isEqualByComparingTo("10.00");
  }

  @Test
  @DisplayName("a negative remainder (rounded up) is also absorbed, by the earliest party")
  void shouldAbsorbNegativeRemainderWithoutCreator() {
    // 5.00 / 3 seats = 1.67 (half up) → 3 × 1.67 = 5.01, one cent too many.
    Split split =
        SharedFareSplitter.split(
            new BigDecimal("5.00"),
            List.of(new Party(SECOND, 2, false), new Party(THIRD, 1, false)));
    assertThat(split.shares().get(SECOND)).isEqualByComparingTo("3.33");
    assertThat(split.shares().get(THIRD)).isEqualByComparingTo("1.67");
    assertThat(sum(split)).isEqualByComparingTo("5.00");
  }

  @Test
  @DisplayName("no boarded party is a programming error")
  void shouldRejectEmptySplit() {
    assertThatThrownBy(() -> SharedFareSplitter.split(BigDecimal.ONE, List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private static BigDecimal sum(Split split) {
    return split.shares().values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
  }
}
