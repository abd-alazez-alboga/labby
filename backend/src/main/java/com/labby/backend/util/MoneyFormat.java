package com.labby.backend.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

/**
 * Money amounts in server-rendered text (NFR-I2, M8 audit W8): grouping separators, Western digits
 * in both languages (owner ruling), SYP without decimals and other currencies with 2, and a leading
 * minus for negative amounts — English {@code SYP 500,000}, Arabic {@code 500,000 ل.س}. A SYP
 * amount that does carry a fraction keeps its 2 decimals rather than being rounded away.
 */
public final class MoneyFormat {

  /** The currency whose amounts render without decimals. */
  private static final String SYP = "SYP";

  /** The Arabic label of the Syrian pound (the owner-approved client label). */
  private static final String SYP_AR = "ل.س";

  private MoneyFormat() {}

  /**
   * The English text of an amount: {@code SYP 500,000}, {@code USD 12.50}, {@code -SYP 45}.
   *
   * @param amount the amount (BigDecimal, Number or its plain string)
   * @param currency the ISO currency code
   * @return the text; empty when the amount is missing
   */
  public static String en(Object amount, String currency) {
    BigDecimal value = parse(amount);
    if (value == null) {
      return fallback(amount, currency);
    }
    return sign(value) + currency + " " + number(value, currency);
  }

  /**
   * The Arabic text of an amount: {@code 500,000 ل.س}, {@code 12.50 USD}, {@code -45 ل.س}.
   *
   * @param amount the amount (BigDecimal, Number or its plain string)
   * @param currency the ISO currency code
   * @return the text; empty when the amount is missing
   */
  public static String ar(Object amount, String currency) {
    BigDecimal value = parse(amount);
    if (value == null) {
      return fallback(amount, currency);
    }
    return sign(value) + number(value, currency) + " " + (SYP.equals(currency) ? SYP_AR : currency);
  }

  private static String number(BigDecimal value, String currency) {
    BigDecimal magnitude = value.abs();
    boolean whole = magnitude.stripTrailingZeros().scale() <= 0;
    DecimalFormat format =
        new DecimalFormat(
            SYP.equals(currency) && whole ? "#,##0" : "#,##0.00",
            DecimalFormatSymbols.getInstance(Locale.ROOT));
    format.setRoundingMode(RoundingMode.HALF_UP);
    return format.format(magnitude);
  }

  private static String sign(BigDecimal value) {
    return value.signum() < 0 ? "-" : "";
  }

  private static BigDecimal parse(Object amount) {
    if (amount instanceof BigDecimal decimal) {
      return decimal;
    }
    if (amount == null || amount.toString().isBlank()) {
      return null;
    }
    try {
      return new BigDecimal(amount.toString().trim());
    } catch (NumberFormatException ex) {
      return null;
    }
  }

  /** A missing amount renders empty; an unparseable one is shown as given (never dropped). */
  private static String fallback(Object amount, String currency) {
    if (amount == null || amount.toString().isBlank()) {
      return "";
    }
    return amount + " " + currency;
  }
}
