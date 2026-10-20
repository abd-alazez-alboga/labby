import { I18n } from "i18n-js";

import { countForm, countKey } from "../plural";
import { translations } from "../translations";

/** V1 audit I90: the Arabic dual and the 11+ form where counts are shown. */
describe("countForm (CLDR ar on n % 100)", () => {
  it.each([
    [1, "one"],
    [2, "two"],
    [3, "few"],
    [10, "few"],
    [11, "many"],
    [99, "many"],
    [103, "few"],
    [111, "many"],
  ] as const)("%d → %s", (count, form) => {
    expect(countForm(count)).toBe(form);
  });
});

describe("Arabic counted nouns", () => {
  const i18n = new I18n(translations);
  const seats = {
    one: "shared.partySeatsOne",
    two: "shared.partySeatsTwo",
    few: "shared.partySeatsMany",
    many: "shared.partySeatsElevenPlus",
  };
  const articles = {
    one: "support.articleCountOne",
    two: "support.articleCountTwo",
    few: "support.articleCount",
    many: "support.articleCountElevenPlus",
  };
  const say = (locale: "en" | "ar", keys: typeof seats, count: number) => {
    i18n.locale = locale;
    return i18n.t(countKey(keys, count), { count });
  };

  it("uses the dual, the plural and the 11+ singular", () => {
    expect(say("ar", seats, 1)).toBe("مقعد واحد");
    expect(say("ar", seats, 2)).toBe("مقعدان");
    expect(say("ar", seats, 4)).toBe("4 مقاعد");
    expect(say("ar", seats, 12)).toBe("12 مقعدًا");
    expect(say("ar", articles, 2)).toBe("مقالان");
    expect(say("ar", articles, 6)).toBe("6 مقالات");
    expect(say("ar", articles, 14)).toBe("14 مقالًا");
  });

  it("keeps the English plural for every count but one", () => {
    expect(say("en", seats, 1)).toBe("1 seat");
    expect(say("en", seats, 2)).toBe("2 seats");
    expect(say("en", seats, 12)).toBe("12 seats");
    expect(say("en", articles, 2)).toBe("2 articles");
  });
});
