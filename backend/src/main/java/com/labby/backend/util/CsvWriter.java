package com.labby.backend.util;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

/**
 * The M15 CSV exports (analytics-v1.yaml, ADM-06): RFC 4180 — comma-separated, CRLF rows, a field
 * quoted (quotes doubled) when it holds a comma, quote, CR or LF — behind a UTF-8 byte-order mark
 * so spreadsheet apps read Arabic correctly. A text cell starting with {@code = + - @}, tab or CR
 * gets a leading {@code '} so a spreadsheet never evaluates it as a formula; numbers are written
 * as-is (a negative amount stays a number). Instants are ISO-8601 UTC; null is an empty cell.
 */
public final class CsvWriter {

  private static final String BOM = "﻿";
  private static final String CRLF = "\r\n";

  private final StringBuilder out = new StringBuilder(BOM);
  private int rows;

  /**
   * Starts a CSV with its header row.
   *
   * @param header the column names
   */
  public CsvWriter(List<String> header) {
    line(header.toArray());
  }

  /**
   * Appends one data row.
   *
   * @param cells the cells, in header order
   * @return this writer
   */
  public CsvWriter row(Object... cells) {
    line(cells);
    rows++;
    return this;
  }

  /**
   * The data rows written so far (the header excluded).
   *
   * @return the count
   */
  public int rows() {
    return rows;
  }

  /**
   * The finished file.
   *
   * @return UTF-8 bytes, byte-order mark first
   */
  public byte[] toBytes() {
    return out.toString().getBytes(StandardCharsets.UTF_8);
  }

  private void line(Object[] cells) {
    for (int i = 0; i < cells.length; i++) {
      if (i > 0) {
        out.append(',');
      }
      out.append(cell(cells[i]));
    }
    out.append(CRLF);
  }

  static String cell(Object value) {
    if (value == null) {
      return "";
    }
    if (value instanceof BigDecimal decimal) {
      return decimal.toPlainString();
    }
    if (value instanceof Number || value instanceof Boolean) {
      return value.toString();
    }
    String text = value instanceof Instant instant ? instant.toString() : value.toString();
    if (!text.isEmpty() && "=+-@\t\r".indexOf(text.charAt(0)) >= 0) {
      text = "'" + text;
    }
    if (text.indexOf(',') >= 0
        || text.indexOf('"') >= 0
        || text.indexOf('\r') >= 0
        || text.indexOf('\n') >= 0) {
      return '"' + text.replace("\"", "\"\"") + '"';
    }
    return text;
  }
}
