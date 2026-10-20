import { describe, expect, it } from 'vitest';

import ar from '../i18n/ar.json';
import en from '../i18n/en.json';

/**
 * M15-T4 (NFR-I1): the automated missing-key check. Every key the source asks for exists in BOTH
 * bundles, no translation is empty, and placeholders match — so a missing or broken Arabic string
 * fails the build instead of silently falling back to English (i18next `fallbackLng: 'en'`).
 */

type Tree = Record<string, unknown>;

/** Dotted leaf key → string value. */
function leaves(tree: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof tree !== 'object' || tree === null) {
    out.set(prefix, String(tree));
    return out;
  }
  for (const [key, child] of Object.entries(tree as Tree)) {
    leaves(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

const EN = leaves(en);
const AR = leaves(ar);
const PLURAL = /_(zero|one|two|few|many|other)$/;

/** A static key resolves when it is a leaf or the base of i18next plural forms. */
function resolves(bundle: Map<string, string>, key: string): boolean {
  if (bundle.has(key)) {
    return true;
  }
  return [...bundle.keys()].some((leaf) => PLURAL.test(leaf) && leaf.replace(PLURAL, '') === key);
}

/** The application sources (tests excluded), as raw text keyed by path. */
const SOURCES = Object.entries(
  import.meta.glob<string>(['../**/*.{ts,tsx}', '!../test/**', '!../**/*.test.{ts,tsx}'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

/** `t('a.b')`, `t("a.b")` and `i18nKey="a.b"`: literal keys. */
const STATIC_KEY =
  /(?:\bt|i18n\.t)\(\s*(['"])([a-zA-Z0-9_.-]+)\1|i18nKey=(['"])([a-zA-Z0-9_.-]+)\3/g;
/** `` t(`a.b.${x}`) ``: the literal prefix before the first interpolation. */
const TEMPLATE_KEY = /(?:\bt|i18n\.t)\(\s*`([a-zA-Z0-9_.-]*)\$\{/g;

function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]));
}

describe('i18n completeness (M15-T4)', () => {
  it('scans the real sources (guards against an empty glob)', () => {
    const keys = SOURCES.flatMap(([, source]) => [...source.matchAll(STATIC_KEY)]);
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(keys.length).toBeGreaterThan(1000);
  });

  it('every literal key used in the source exists in EN and AR', () => {
    const missing: string[] = [];
    for (const [path, source] of SOURCES) {
      for (const match of source.matchAll(STATIC_KEY)) {
        const key = match[2] ?? match[4];
        if (!key.includes('.')) {
          continue; // not a translation key (e.g. t('x') on another object)
        }
        for (const [lang, bundle] of [
          ['en', EN],
          ['ar', AR],
        ] as const) {
          if (!resolves(bundle, key)) {
            missing.push(`${lang}: ${key} (${path})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every template key prefix names real keys in EN and AR', () => {
    const missing: string[] = [];
    for (const [path, source] of SOURCES) {
      for (const match of source.matchAll(TEMPLATE_KEY)) {
        const prefix = match[1];
        if (prefix === '') {
          continue; // a fully dynamic key; covered by its own catalog
        }
        for (const [lang, bundle] of [
          ['en', EN],
          ['ar', AR],
        ] as const) {
          if (![...bundle.keys()].some((leaf) => leaf.startsWith(prefix))) {
            missing.push(`${lang}: ${prefix}… (${path})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('no translation is empty', () => {
    const empty = [...EN, ...AR].filter(([, value]) => value.trim() === '').map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('AR placeholders match EN (Arabic plural forms may drop {{count}})', () => {
    const mismatched: string[] = [];
    for (const [key, enText] of EN) {
      const arText = AR.get(key);
      if (arText === undefined) {
        continue; // key parity is i18n-parity.test.ts
      }
      const enVars = placeholders(enText);
      const arVars = placeholders(arText);
      const unknown = [...arVars].filter((name) => !enVars.has(name));
      const dropped = [...enVars].filter(
        (name) => !arVars.has(name) && !(name === 'count' && PLURAL.test(key)),
      );
      if (unknown.length > 0 || dropped.length > 0) {
        mismatched.push(`${key}: unknown [${unknown.join(',')}] dropped [${dropped.join(',')}]`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('Arabic strings never carry Arabic-Indic digits (owner ruling: Western digits)', () => {
    const indic = [...AR].filter(([, value]) => /[٠-٩۰-۹]/.test(value));
    expect(indic.map(([key]) => key)).toEqual([]);
  });
});
