/**
 * Phone canonicalization (owner ruling on V1 audit H3: phones are stored as E.164 with a Syria
 * default). Mirrors the backend normalizer so what an admin types — at login, when adding an
 * admin, or in a phone search — matches the stored form:
 *
 * - spaces and dashes are dropped;
 * - `09xxxxxxxx` (Syrian national mobile) → `+9639xxxxxxxx`;
 * - `009639…` → `+9639…`;
 * - `9639…` → `+9639…`;
 * - anything starting with `+` is kept; anything else is returned stripped, for the server to judge.
 */
export function normalizePhone(raw: string): string {
  const compact = raw.trim().replace(/[\s-]/g, '');
  if (compact.startsWith('+')) {
    return compact;
  }
  if (/^09\d{8}$/.test(compact)) {
    return `+963${compact.slice(1)}`;
  }
  if (compact.startsWith('009639')) {
    return `+${compact.slice(2)}`;
  }
  if (compact.startsWith('9639')) {
    return `+${compact}`;
  }
  return compact;
}
