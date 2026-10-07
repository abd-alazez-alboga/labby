import { translations } from "../translations";

function keys(tree: object, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    value && typeof value === "object"
      ? keys(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("translations", () => {
  it("has the same keys in EN and AR", () => {
    expect(keys(translations.ar).sort()).toEqual(keys(translations.en).sort());
  });

  it("has no empty strings", () => {
    for (const locale of [translations.en, translations.ar]) {
      const empty = keys(locale).filter((path) => {
        const value = path
          .split(".")
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)[part],
            locale,
          );
        return typeof value !== "string" || value.trim() === "";
      });
      expect(empty).toEqual([]);
    }
  });
});
