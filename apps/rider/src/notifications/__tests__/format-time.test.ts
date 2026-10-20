/**
 * M15-T4 regression — notification timestamps keep Western digits in
 * Arabic (owner ruling 2026-10-11). Node's ICU formats plain `ar` with
 * Western digits, which would hide the bug, so this simulates a device ICU
 * (e.g. Hermes) whose `ar` defaults to Arabic-Indic digits unless the locale
 * carries `-u-nu-latn`.
 */
import { formatNotificationTime } from "../format-time";

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const NON_WESTERN_DIGITS = /[٠-٩۰-۹]/u;

function simulateArabicIndicIcu(): () => void {
  const RealDateTimeFormat = Intl.DateTimeFormat;
  function Simulated(
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    const formatter = new RealDateTimeFormat(locales, options);
    const first = Array.isArray(locales) ? locales[0] : locales;
    const arabicIndic =
      typeof first === "string" &&
      /^ar(-|$)/u.test(first) &&
      !first.includes("-nu-latn");
    if (!arabicIndic) return formatter;
    return new Proxy(formatter, {
      get(target, property) {
        if (property === "format") {
          return (date: Date) =>
            target
              .format(date)
              .replace(/[0-9]/gu, (digit) => ARABIC_INDIC[Number(digit)]);
        }
        const member = Reflect.get(target, property) as unknown;
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
  }
  Intl.DateTimeFormat = Simulated as unknown as typeof Intl.DateTimeFormat;
  return () => {
    Intl.DateTimeFormat = RealDateTimeFormat;
  };
}

describe("formatNotificationTime", () => {
  let restore: () => void = () => undefined;
  beforeEach(() => {
    restore = simulateArabicIndicIcu();
  });
  afterEach(() => restore());

  const now = new Date(2026, 9, 20, 12, 0);

  it("renders an Arabic same-day time with Western digits", () => {
    const iso = new Date(2026, 9, 20, 9, 5).toISOString();
    const text = formatNotificationTime(iso, "ar", now);
    expect(text).toMatch(/9:05/);
    expect(text).not.toMatch(NON_WESTERN_DIGITS);
  });

  it("renders an Arabic earlier-day date and time with Western digits", () => {
    const iso = new Date(2026, 9, 19, 21, 30).toISOString();
    const text = formatNotificationTime(iso, "ar", now);
    expect(text).toMatch(/19/);
    expect(text).toMatch(/9:30/);
    expect(text).not.toMatch(NON_WESTERN_DIGITS);
  });

  it("keeps English unchanged", () => {
    const iso = new Date(2026, 9, 20, 9, 5).toISOString();
    expect(formatNotificationTime(iso, "en", now)).toMatch(/9:05/);
  });
});
