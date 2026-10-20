/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MAP_COLORS } from '../theme/map-colors';

// Read from disk: with `css: false` Vitest hands every CSS import (even `?raw`) back empty.
// Vitest runs from the app root (apps/admin), like `npm run test`.
function readTheme(file: string): string {
  return readFileSync(`${process.cwd()}/src/theme/${file}`, 'utf-8');
}

const globalCss = readTheme('global.css');
const tokensCss = readTheme('tokens.css');

/**
 * M1-T3 AC "theme uses token variables (no hardcoded colors)", re-broken by later milestones
 * (V1 audit W33 / I103): every colour lives in tokens.css; global.css only references tokens.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function tokenValue(name: string): string | undefined {
  return new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(tokensCss)?.[1].trim();
}

describe('theme tokens (W33, I103)', () => {
  it('reads both theme files', () => {
    expect(globalCss).toContain('.page-header');
    expect(tokensCss).toMatch(/^:root \{/m);
  });

  it('global.css has no raw colour literals', () => {
    const literals = withoutComments(globalCss).match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
    expect(literals).toEqual([]);
  });

  it('every token global.css references is defined in tokens.css', () => {
    const used = new Set(
      [...withoutComments(globalCss).matchAll(/var\((--labby-[a-z0-9-]+)\)/g)].map((m) => m[1]),
    );
    const missing = [...used].filter((name) => tokenValue(name) === undefined);
    expect(missing).toEqual([]);
  });

  it('the map colour constants mirror their tokens', () => {
    expect(MAP_COLORS.accent.toLowerCase()).toBe(tokenValue('--labby-accent'));
    expect(MAP_COLORS.muted.toLowerCase()).toBe(tokenValue('--labby-text-secondary'));
    expect(MAP_COLORS.surface.toLowerCase()).toBe(tokenValue('--labby-surface'));
    expect(MAP_COLORS.sos.toLowerCase()).toBe(tokenValue('--labby-sos'));
  });
});
