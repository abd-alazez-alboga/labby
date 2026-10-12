/**
 * Money display for the M8 screens (NFR-I2, owner rulings 2026-10-11):
 * Arabic uses WESTERN digits everywhere, SYP shows as "ل.س" in Arabic, and
 * any amount embedded in RTL text travels inside an LTR isolate
 * (U+2066…U+2069 — the M7 phone-number pattern) so the sign and grouping
 * never bidi-reorder. Amounts are ALWAYS stored server numbers — nothing
 * here computes money.
 */

/** LTR isolate pair around an amount inside RTL text. */
export const LTR_ISOLATE_START = "⁦";
export const LTR_ISOLATE_END = "⁩";

/** Typographic minus (the approved artboards use U+2212, not a hyphen). */
export const MINUS = "−";

/** Western digits in BOTH languages (owner ruling 2026-10-11). */
export function formatAmountValue(
  value: number,
  maximumFractionDigits = 2,
): string {
  try {
    return new Intl.NumberFormat("en-GB", { maximumFractionDigits }).format(
      value,
    );
  } catch {
    return String(value);
  }
}

/** Wraps a bare number/sign run in an LTR isolate when the UI is Arabic. */
export function isolateDigits(text: string, language: string): string {
  return language === "ar"
    ? `${LTR_ISOLATE_START}${text}${LTR_ISOLATE_END}`
    : text;
}

/** The currency's display label: SYP shows as "ل.س" in Arabic (NFR-I2). */
export function currencyLabel(currency: string, language: string): string {
  if (language === "ar" && currency === "SYP") return "ل.س";
  return currency;
}

function compose(
  numeric: string,
  currency: string,
  language: string,
): string {
  if (language === "ar") {
    // "⁦−7,000⁩ ل.س" — the signed number stays LTR inside the RTL line.
    return `${LTR_ISOLATE_START}${numeric}${LTR_ISOLATE_END} ${currencyLabel(currency, language)}`;
  }
  return `${currencyLabel(currency, language)} ${numeric}`;
}

/** Unsigned amount: "SYP 28,000" / "⁦28,000⁩ ل.س". */
export function formatMoney(
  amount: number,
  currency: string,
  language: string,
): string {
  return compose(formatAmountValue(Math.abs(amount)), currency, language);
}

/**
 * Signed amount: "−SYP 7,000", "+SYP 5,000" (with `alwaysSign`) /
 * "⁦−7,000⁩ ل.س". In English the sign precedes the currency, as on the
 * approved artboards.
 */
export function formatSignedMoney(
  amount: number,
  currency: string,
  language: string,
  options: { alwaysSign?: boolean } = {},
): string {
  const sign =
    amount < 0 ? MINUS : options.alwaysSign && amount > 0 ? "+" : "";
  const numeric = formatAmountValue(Math.abs(amount));
  if (language === "ar") {
    return compose(`${sign}${numeric}`, currency, language);
  }
  return `${sign}${compose(numeric, currency, language)}`;
}
