/**
 * Labby design tokens — TypeScript port for React Native.
 *
 * SOURCE OF TRUTH: /assets/theme/colors.scss (repo root) and
 * docs/design/design-system.md. Any change there must be mirrored here
 * (names map 1:1, `--labby-accent-tint` -> `colors.accentTint`, etc.).
 * Do not hardcode colors anywhere in the app — always import from this module.
 */

export const colors = {
  // ---- Design system 2026-10-07 (owner-approved canvas) ----
  // Labby purple is the ONLY accent; status colours only in chips/banners.

  // Accent
  accent: "#59128A", // primary buttons, selected state, links, GO button
  accentPressed: "#3D0B57", // pressed state of accent
  accentTint: "#F1EAF8", // accent chip ground, avatar ground
  onAccent: "#FFFFFF",

  // Text
  text: "#141018", // primary text, icons, selected outlines
  textSecondary: "#463C58",
  textMuted: "#6E6780", // captions, hints
  textSubtle: "#B7AECB", // placeholders, the offline status dot

  // Surfaces
  surface: "#FFFFFF", // sheets, cards, screens
  surfacePage: "#F7F6F9",
  surfaceFill: "#F2F0F5", // inputs, icon wells, secondary buttons
  surfaceMap: "#ECE9F0", // map ground / placeholder

  // Lines
  line: "#EEEBF2", // row dividers
  lineStrong: "#DCD8E2", // outlined buttons, unselected chip outline
  grabHandle: "#D9D5DF", // bottom-sheet handle

  // Status (chips, banners only — never as accents)
  success: "#067647",
  successBg: "#ECFDF3",
  warning: "#93370D",
  warningBg: "#FFF6E5",
  danger: "#B42318",
  dangerBg: "#FEF3F2",
  online: "#12B76A", // the online status dot only

  // Functional safety red (owner-approved 2026-10-13, M10 canvas) — the
  // SOS pill / confirm ONLY; never an accent anywhere else.
  sos: "#D92D20",
  sosBg: "#FEE4E2",

  // Shadow ink (rgba(20,16,24,…) in the spec)
  shadow: "#141018",

  // ---- Legacy (colors.scss pre-2026-10-07) — no new usages ----
  logoPurple: "#592D87",
  logoCharcoal: "#231F20",
  purple900: "#3D0B57",
  purple800: "#430C68",
  purple700: "#59128A",
  purple600: "#631A95",
  purple500: "#7A2DAE",
  purple450: "#8A2FB3",
  purple400: "#9B3FC4",
  lavender300: "#CDBDFF",
  lavender200: "#D9CCFF",
  lilac200: "#E8DCF0",
  lilac100: "#EBD8F7",
  lavender100: "#EFE9FF",
  bgTint: "#F5EEF9",
  bgLight: "#FAF7FC",
  white: "#FFFFFF",
} as const;

/**
 * Legacy gradients from colors.scss. The design system forbids gradients in
 * new code; kept only so the mirror stays complete.
 */
export const gradients = {
  hero: [colors.purple900, colors.purple700], // --labby-gradient-hero
  button: [colors.purple700, colors.purple500], // --labby-gradient-button
} as const;

/** Spacing scale 4 / 8 / 12 / 16 / 20 / 24 / 32. */
export const spacing = {
  xs: 4,
  sm: 8,
  ms: 12,
  md: 16,
  ml: 20, // screen side gutter, sheet padding
  lg: 24,
  xl: 32,
} as const;

/** Radii: chip 8, mobile buttons/inputs 14, cards 16, sheet top 24, round. */
export const radius = {
  sm: 8,
  chip: 12,
  md: 14,
  lg: 16,
  sheet: 24,
  round: 999,
} as const;

/** Minimum bottom padding of sheets / pinned footers (or the inset, if larger). */
export const BOTTOM_SAFE_MIN = 34;

/** Shadows: floating buttons and bottom sheets. */
export const shadows = {
  floating: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 4,
  },
  sheet: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;

/** Type scale (mobile): size / weight / line height. */
export const typography = {
  display: { fontSize: 32, weight: "800", lineHeight: 38, letterSpacing: -0.6 },
  title: { fontSize: 26, weight: "800", lineHeight: 32, letterSpacing: -0.4 },
  heading: { fontSize: 20, weight: "800", lineHeight: 26 },
  rowTitle: { fontSize: 17, weight: "700", lineHeight: 22 },
  bodyStrong: { fontSize: 16, weight: "700", lineHeight: 22 },
  body: { fontSize: 15, weight: "400", lineHeight: 22 },
  secondary: { fontSize: 14, weight: "400", lineHeight: 20 },
  label: { fontSize: 14, weight: "600", lineHeight: 20 },
  caption: { fontSize: 13, weight: "600", lineHeight: 18 },
  button: { fontSize: 18, weight: "800", lineHeight: 24 },
} as const;

export type ColorToken = keyof typeof colors;
export type TypeVariant = keyof typeof typography;
export type FontWeight = "400" | "600" | "700" | "800";

export const tokens = {
  colors,
  gradients,
  spacing,
  radius,
  shadows,
  typography,
} as const;
