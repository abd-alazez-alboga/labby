import ar from "../i18n/translations/ar.json";
import en from "../i18n/translations/en.json";

/**
 * M15-T4 (NFR-I1): the automated missing-key check. Every key the source asks for exists in BOTH
 * bundles, placeholders match, and Arabic carries Western digits only — so a missing or broken
 * Arabic string fails `npm run check` instead of silently falling back to English (i18next `fallbackLng: "en"`).
 */

type FsLike = {
  readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): {
    name: string;
    isDirectory(): boolean;
  }[];
  readFileSync(path: string, encoding: "utf8"): string;
};
// Jest runs in Node; the RN tsconfig ships no Node types.
declare const __dirname: string;
const fs: FsLike = jest.requireActual("fs");

function leaves(
  tree: unknown,
  prefix = "",
  out = new Map<string, string>(),
): Map<string, string> {
  if (typeof tree !== "object" || tree === null) {
    out.set(prefix, String(tree));
    return out;
  }
  for (const [key, child] of Object.entries(tree as Record<string, unknown>)) {
    leaves(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

const EN = leaves(en);
const AR = leaves(ar);
const PLURAL_NAMES = "zero|one|two|few|many|other";
const PLURAL_SUFFIX = new RegExp(`_(${PLURAL_NAMES})$`);
const PLURAL_CHILD = new RegExp(`\\.(${PLURAL_NAMES})$`);

/** A key resolves as a leaf, an i18next `_one` plural base, or a `.one` plural object. */
function resolves(bundle: Map<string, string>, key: string): boolean {
  if (bundle.has(key)) {
    return true;
  }
  for (const leaf of bundle.keys()) {
    if (PLURAL_SUFFIX.test(leaf) && leaf.replace(PLURAL_SUFFIX, "") === key) {
      return true;
    }
    if (PLURAL_CHILD.test(leaf) && leaf.replace(PLURAL_CHILD, "") === key) {
      return true;
    }
  }
  return false;
}

/** The application sources (tests and test utilities excluded). */
function sources(dir: string): [string, string][] {
  const found: [string, string][] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!["__tests__", "test-utils", "node_modules"].includes(entry.name)) {
        found.push(...sources(path));
      }
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      found.push([path, fs.readFileSync(path, "utf8")]);
    }
  }
  return found;
}

const SOURCES = sources(`${__dirname}/..`);
const STATIC_KEY = /(?:\bt|i18n\.t)\(\s*(["'])([a-zA-Z0-9_.-]+)\1/g;
const TEMPLATE_KEY = /(?:\bt|i18n\.t)\(\s*`([a-zA-Z0-9_.-]*)\$\{/g;
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]));
}

/** Deliberate EN/AR placeholder differences (the code passes every listed value). */
const ALLOWED_DIFFERENCES: Record<string, string> = {
  "incentives.rating.subtitle":
    "AR uses the pluralized phrase {{trips}} (e.g. 30 رحلة); EN the bare {{count}}+",
};

function isPluralForm(key: string): boolean {
  return PLURAL_SUFFIX.test(key) || PLURAL_CHILD.test(key);
}

describe("i18n completeness (M15-T4)", () => {
  it("scans the real sources (guards against an empty walk)", () => {
    const keys = SOURCES.flatMap(([, source]) => [
      ...source.matchAll(STATIC_KEY),
    ]);
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(keys.length).toBeGreaterThan(500);
  });

  it("every literal key used in the source exists in EN and AR", () => {
    const missing: string[] = [];
    for (const [path, source] of SOURCES) {
      for (const match of source.matchAll(STATIC_KEY)) {
        const key = match[2];
        if (!key.includes(".")) {
          continue;
        }
        if (!resolves(EN, key)) {
          missing.push(`en: ${key} (${path})`);
        }
        if (!resolves(AR, key)) {
          missing.push(`ar: ${key} (${path})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every template key prefix names real keys in EN and AR", () => {
    const missing: string[] = [];
    for (const [path, source] of SOURCES) {
      for (const match of source.matchAll(TEMPLATE_KEY)) {
        const prefix = match[1];
        if (prefix === "") {
          continue;
        }
        for (const [lang, bundle] of [
          ["en", EN],
          ["ar", AR],
        ] as const) {
          if (![...bundle.keys()].some((leaf) => leaf.startsWith(prefix))) {
            missing.push(`${lang}: ${prefix}… (${path})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("no translation is empty", () => {
    const empty = [...EN, ...AR]
      .filter(([, value]) => value.trim() === "")
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it("AR placeholders match EN (Arabic plural forms may drop the number)", () => {
    const mismatched: string[] = [];
    for (const [key, enText] of EN) {
      const arText = AR.get(key);
      if (arText === undefined || key in ALLOWED_DIFFERENCES) {
        continue;
      }
      const enVars = placeholders(enText);
      const arVars = placeholders(arText);
      const unknown = [...arVars].filter((name) => !enVars.has(name));
      const dropped = [...enVars].filter(
        (name) => !arVars.has(name) && !isPluralForm(key),
      );
      if (unknown.length > 0 || dropped.length > 0) {
        mismatched.push(
          `${key}: unknown [${unknown.join(",")}] dropped [${dropped.join(",")}]`,
        );
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("Arabic strings never carry Arabic-Indic digits (owner ruling: Western digits)", () => {
    const indic = [...AR].filter(([, value]) =>
      /[\u0660-\u0669\u06F0-\u06F9]/.test(value),
    );
    expect(indic.map(([key]) => key)).toEqual([]);
  });
});
