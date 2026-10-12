/**
 * Money + date formatting for the M8 admin screens (NFR-I2). Owner ruling
 * 2026-10-11: the Arabic UI uses WESTERN digits everywhere, and amounts are
 * wrapped in `dir="ltr"` so a sign never detaches from its number in RTL
 * text — the `Money` component in MoneyUi.tsx applies that.
 */

/** The UI locale, pinned to Latin (Western) digits in Arabic. */
export function latinLocale(language: string): string {
  return language.startsWith('ar') ? 'ar-u-nu-latn' : language;
}

/** Grouped plain number, exact decimals kept up to 2 places, true minus sign. */
export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(latinLocale(language), {
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace(/^-/, '−');
}

/**
 * An amount with its currency label, e.g. "SYP 20,000" / "ل.س 20,000".
 * `currencyLabel` is the translated label for the code (money.currency.*),
 * resolved by the caller so this stays a plain function.
 */
export function formatMoney(value: number, currencyLabel: string, language: string): string {
  return `${currencyLabel} ${formatNumber(value, language)}`;
}

/** A SIGNED amount for ledger columns: leading + on credits, − on debits. */
export function formatSigned(value: number, language: string): string {
  const absolute = formatNumber(Math.abs(value), language);
  return value < 0 ? `−${absolute}` : `+${absolute}`;
}

/** Short calendar date for table "When" columns (e.g. "9 Oct 2026"). */
export function formatDay(value: string, language: string): string {
  return new Date(value).toLocaleDateString(latinLocale(language), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Date + time for ride references (e.g. "8 Oct, 12:29"). */
export function formatMoment(value: string, language: string): string {
  return new Date(value).toLocaleString(latinLocale(language), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a lookup input is a pasted user/ride ID rather than a phone. */
export function isUuid(value: string): boolean {
  return UUID.test(value.trim());
}

/** Parses an amount field; null when not a positive finite number. */
export function parseAmount(raw: string): number | null {
  const value = Number(raw.replace(/[\s,]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}
