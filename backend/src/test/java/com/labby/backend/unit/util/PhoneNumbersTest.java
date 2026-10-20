package com.labby.backend.unit.util;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.util.PhoneNumbers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Review V1 H3 (owner ruling 2026-10-20): one canonicalizer, E.164 with the Syria default — every
 * typed form of one handset is one identity, foreign numbers must carry {@code +}.
 */
class PhoneNumbersTest {

  @ParameterizedTest(name = "{0} -> {1}")
  @CsvSource({
    "0933000111, +963933000111",
    "+963933000111, +963933000111",
    "963933000111, +963933000111",
    "00963933000111, +963933000111",
    "'093 300 0111', +963933000111",
    "'+963 933-000-111', +963933000111",
    "'  0933000111  ', +963933000111",
    "+447700900123, +447700900123",
    "0044 7700 900123, +447700900123"
  })
  @DisplayName("every typed form normalizes to E.164 and validates")
  void shouldNormalizeToE164(String raw, String expected) {
    String normalized = PhoneNumbers.normalize(raw);
    assertThat(normalized).isEqualTo(expected).matches(PhoneNumbers.E164);
    // Idempotent: the canonical form is a fixed point.
    assertThat(PhoneNumbers.normalize(normalized)).isEqualTo(normalized);
  }

  @ParameterizedTest
  @ValueSource(strings = {"447700900123", "933000111", "+0963933000111", "09", "abc", "+963-x"})
  @DisplayName("a bare foreign number, a too-short or non-numeric value stays invalid")
  void shouldLeaveUnknownFormsInvalid(String raw) {
    assertThat(PhoneNumbers.normalize(raw)).doesNotMatch(PhoneNumbers.E164);
  }

  @Test
  @DisplayName("null passes through for @NotBlank to report")
  void shouldPassNullThrough() {
    assertThat(PhoneNumbers.normalize(null)).isNull();
  }
}
