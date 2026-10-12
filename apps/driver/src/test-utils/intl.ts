/**
 * Simulates a Hermes build whose ICU formats plain `ar` with Arabic-Indic
 * digits (Node's ICU defaults `ar` to Western digits, which would hide the
 * bug): every Intl.NumberFormat / Intl.DateTimeFormat created for an `ar`
 * locale WITHOUT `-nu-latn` maps its output to ٠–٩. Screens that honour the
 * Western-digits ruling (`ar-u-nu-latn`) are unaffected. Returns a restore.
 */
const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

function defaultsToArabicIndic(locales: unknown): boolean {
  const first = Array.isArray(locales) ? locales[0] : locales;
  return (
    typeof first === "string" &&
    /^ar(-|$)/u.test(first) &&
    !first.includes("-nu-latn")
  );
}

function toArabicIndic(text: string): string {
  return text.replace(/[0-9]/gu, (digit) => ARABIC_INDIC[Number(digit)]);
}

function wrap<T extends { format: (value: never) => string }>(
  Real: new (locales?: unknown, options?: unknown) => T,
): new (locales?: unknown, options?: unknown) => T {
  function Simulated(locales?: unknown, options?: unknown): T {
    const formatter = new Real(locales, options);
    if (!defaultsToArabicIndic(locales)) return formatter;
    return new Proxy(formatter, {
      get(target, property) {
        if (property === "format") {
          return (value: never) => toArabicIndic(target.format(value));
        }
        const member = Reflect.get(target, property) as unknown;
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
  }
  return Simulated as unknown as new (locales?: unknown, options?: unknown) => T;
}

export function simulateArabicIndicIcu(): () => void {
  const RealNumberFormat = Intl.NumberFormat;
  const RealDateTimeFormat = Intl.DateTimeFormat;
  Intl.NumberFormat = wrap(
    RealNumberFormat as never,
  ) as unknown as typeof Intl.NumberFormat;
  Intl.DateTimeFormat = wrap(
    RealDateTimeFormat as never,
  ) as unknown as typeof Intl.DateTimeFormat;
  return () => {
    Intl.NumberFormat = RealNumberFormat;
    Intl.DateTimeFormat = RealDateTimeFormat;
  };
}

/** Any Arabic-Indic (U+0660–0669) or Eastern Arabic-Indic digit. */
export const NON_WESTERN_DIGITS = /[٠-٩۰-۹]/u;
