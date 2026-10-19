package com.labby.backend.unit.util;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.util.CsvWriter;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The CSV export format (analytics-v1.yaml {@code Csv}, ADM-06). */
class CsvWriterTest {

  private static String text(CsvWriter writer) {
    return new String(writer.toBytes(), StandardCharsets.UTF_8);
  }

  @Test
  @DisplayName("a UTF-8 byte-order mark, a header row and CRLF rows; null is an empty cell")
  void shouldWriteBomHeaderAndRows() {
    CsvWriter writer = new CsvWriter(List.of("id", "name", "note"));
    writer.row("a1", "رنا", null);
    byte[] bytes = writer.toBytes();
    assertThat(bytes[0]).isEqualTo((byte) 0xEF);
    assertThat(bytes[1]).isEqualTo((byte) 0xBB);
    assertThat(bytes[2]).isEqualTo((byte) 0xBF);
    assertThat(text(writer)).isEqualTo("﻿id,name,note\r\na1,رنا,\r\n");
    assertThat(writer.rows()).isEqualTo(1);
  }

  @Test
  @DisplayName("commas, quotes and line breaks are quoted, quotes doubled (RFC 4180)")
  void shouldQuoteSpecialCharacters() {
    CsvWriter writer = new CsvWriter(List.of("v"));
    writer.row("a,b").row("say \"hi\"").row("line1\nline2");
    assertThat(text(writer))
        .isEqualTo("﻿v\r\n\"a,b\"\r\n\"say \"\"hi\"\"\"\r\n\"line1\nline2\"\r\n");
  }

  @Test
  @DisplayName("text starting with = + - @ or tab is defused with a leading quote; numbers are not")
  void shouldGuardAgainstFormulaInjection() {
    CsvWriter writer = new CsvWriter(List.of("v"));
    writer
        .row("=HYPERLINK(\"x\")")
        .row("+1")
        .row("-2")
        .row("@SUM(A1)")
        .row("\tx")
        .row(new BigDecimal("-12.50"))
        .row(7L)
        .row(true);
    assertThat(text(writer))
        .isEqualTo(
            "﻿v\r\n\"'=HYPERLINK(\"\"x\"\")\"\r\n'+1\r\n'-2\r\n'@SUM(A1)\r\n'\tx\r\n"
                + "-12.50\r\n7\r\ntrue\r\n");
  }

  @Test
  @DisplayName("instants are ISO-8601 UTC and decimals keep their scale")
  void shouldFormatInstantsAndDecimals() {
    CsvWriter writer = new CsvWriter(List.of("at", "amount"));
    writer.row(Instant.parse("2026-10-20T08:15:30Z"), new BigDecimal("3.00"));
    assertThat(text(writer)).isEqualTo("﻿at,amount\r\n2026-10-20T08:15:30Z,3.00\r\n");
  }
}
