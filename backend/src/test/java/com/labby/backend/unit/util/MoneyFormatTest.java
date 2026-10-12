package com.labby.backend.unit.util;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.util.MoneyFormat;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * NFR-I2 money text in pushes (M8 audit W8): grouping, SYP without decimals, other currencies with
 * 2, Western digits in both languages, a leading minus, EN {@code SYP 500,000} / AR {@code 500,000
 * ل.س}.
 */
class MoneyFormatTest {

  @Test
  @DisplayName("SYP: grouped, no decimals; EN code first, AR number then ل.س")
  void shouldFormatSyp() {
    assertThat(MoneyFormat.en("500000.00", "SYP")).isEqualTo("SYP 500,000");
    assertThat(MoneyFormat.ar("500000.00", "SYP")).isEqualTo("500,000 ل.س");
    assertThat(MoneyFormat.en(new BigDecimal("1234567"), "SYP")).isEqualTo("SYP 1,234,567");
    assertThat(MoneyFormat.en(750, "SYP")).isEqualTo("SYP 750");
    // Western digits only, never Arabic-Indic.
    assertThat(MoneyFormat.ar("1234567.00", "SYP")).doesNotContainPattern("[\\u0660-\\u0669]");
  }

  @Test
  @DisplayName("a SYP amount with a real fraction keeps 2 decimals instead of being rounded away")
  void shouldKeepSypFraction() {
    assertThat(MoneyFormat.en("0.25", "SYP")).isEqualTo("SYP 0.25");
    assertThat(MoneyFormat.ar("1500.5", "SYP")).isEqualTo("1,500.50 ل.س");
  }

  @Test
  @DisplayName("other currencies: grouped with 2 decimals, the ISO code in both languages")
  void shouldFormatOtherCurrencies() {
    assertThat(MoneyFormat.en("12.5", "USD")).isEqualTo("USD 12.50");
    assertThat(MoneyFormat.ar("12.5", "USD")).isEqualTo("12.50 USD");
    assertThat(MoneyFormat.en("1234.567", "EUR")).isEqualTo("EUR 1,234.57"); // HALF_UP
    assertThat(MoneyFormat.en("7", "USD")).isEqualTo("USD 7.00");
  }

  @Test
  @DisplayName("negative amounts carry a leading minus")
  void shouldLeadWithMinus() {
    assertThat(MoneyFormat.en("-500000.00", "SYP")).isEqualTo("-SYP 500,000");
    assertThat(MoneyFormat.ar("-500000.00", "SYP")).isEqualTo("-500,000 ل.س");
    assertThat(MoneyFormat.en("-45.5", "USD")).isEqualTo("-USD 45.50");
    assertThat(MoneyFormat.ar("-45.5", "USD")).isEqualTo("-45.50 USD");
  }

  @Test
  @DisplayName("a missing amount renders empty; an unparseable one is shown as given")
  void shouldHandleMissingAndUnparseable() {
    assertThat(MoneyFormat.en(null, "SYP")).isEmpty();
    assertThat(MoneyFormat.ar("", "SYP")).isEmpty();
    assertThat(MoneyFormat.en("n/a", "SYP")).isEqualTo("n/a SYP");
  }
}
