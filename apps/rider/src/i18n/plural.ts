/**
 * Counted-noun forms (V1 audit I90). Arabic counts need more than one/many:
 * 1 (مقعد واحد), 2 — the dual (مقعدان), 3–10 — the plural (3 مقاعد) and
 * 11+ — the singular accusative (11 مقعدًا), per the CLDR `ar` rules on
 * n % 100. English simply uses its plural for every form but `one`.
 */
export type CountForm = "one" | "two" | "few" | "many";

export function countForm(count: number): CountForm {
  const n = Math.abs(Math.trunc(count));
  if (n === 1) return "one";
  if (n === 2) return "two";
  const rest = n % 100;
  return rest >= 3 && rest <= 10 ? "few" : "many";
}

/** The translation key of `count`'s form among the four given keys. */
export function countKey(
  keys: Record<CountForm, string>,
  count: number,
): string {
  return keys[countForm(count)];
}
