/**
 * Money + date formatting for the M8 admin screens (NFR-I2). Owner ruling
 * 2026-10-11: the Arabic UI uses WESTERN digits everywhere, and amounts are
 * wrapped in `dir="ltr"` so a sign never detaches from its number in RTL
 * text — the `Money` component in MoneyUi.tsx applies that.
 */

import { ApiError } from '../../api/client';

/** The UI locale, pinned to Latin (Western) digits in Arabic. */
export function latinLocale(language: string): string {
  return language.startsWith('ar') ? 'ar-u-nu-latn' : language;
}

/**
 * Grouped plain number, exact decimals kept up to 2 places, true minus sign.
 * Arabic output prefixes negatives with a bidi mark (LRM, e.g. "\u200E-430,000"),
 * so the hyphen is matched after an optional leading mark.
 */
export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(latinLocale(language), {
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace(/^([\u200e\u200f\u061c]?)-/, '$1−');
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

const AMOUNT = /^\d+(\.\d{1,2})?$/;

/**
 * Parses an amount field once grouping (spaces, commas) is stripped: plain
 * digits with at most 2 decimals (the server's scale). Null for anything
 * else — signs, exponents, hex — or a zero amount.
 */
export function parseAmount(raw: string): number | null {
  const stripped = raw.replace(/[\s,]/g, '');
  if (!AMOUNT.test(stripped)) {
    return null;
  }
  const value = Number(stripped);
  return value > 0 ? value : null;
}

/** The backend's message for a 400 rejection, shown under the generic banner. */
export function rejectionDetail(error: unknown): string | null {
  return error instanceof ApiError && error.status === 400 ? (error.serverMessage ?? null) : null;
}
