/**
 * H3 (owner ruling 2026-10-20): phones are stored as E.164 with a Syria
 * default. Mirrors the backend canonicalizer so the number a driver types
 * reaches the API in the same form whichever way it was written:
 *
 * - spaces and dashes are dropped;
 * - `+…` is kept as typed;
 * - `009639…` → `+9639…` and `9639…` → `+9639…` (Syrian mobiles);
 * - the local mobile form `09xxxxxxxx` → `+9639xxxxxxxx`.
 *
 * Anything else is returned stripped but otherwise untouched, so the
 * contract pattern (PHONE_PATTERN) and the server still judge it.
 */
export const SYRIA_COUNTRY_CODE = "963";

const LOCAL_SYRIAN_MOBILE = /^09[0-9]{8}$/;

export function normalizePhone(input: string): string {
  const compact = input.trim().replace(/[\s-]+/g, "");
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith(`00${SYRIA_COUNTRY_CODE}9`)) {
    return `+${compact.slice(2)}`;
  }
  if (compact.startsWith(`${SYRIA_COUNTRY_CODE}9`)) return `+${compact}`;
  if (LOCAL_SYRIAN_MOBILE.test(compact)) {
    return `+${SYRIA_COUNTRY_CODE}${compact.slice(1)}`;
  }
  return compact;
}
