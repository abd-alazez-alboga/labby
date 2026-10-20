/**
 * Labby design tokens.
 *
 * Color values are ported 1:1 from /assets/theme/colors.scss at the repo
 * root — that file is the SOURCE OF TRUTH for brand colors. If it changes,
 * update this module to match; never edit colors here independently.
 *
 * The "Design system 2026-10-07" block (docs/design/design-system.md) is what
 * new code uses: Labby purple `accent` is the ONLY accent, status colours
 * appear only in chips and banners. The legacy palette below it stays only
 * as a mirror of colors.scss — no new usages, no gradients.
 */

export const colors = {
  // ---- Design system 2026-10-07 ----
  accent: "#59128A",
  accentPressed: "#3D0B57",
  accentTint: "#F1EAF8",
  onAccent: "#FFFFFF",

  text: "#141018",
  textSecondary: "#463C58",
  textMuted: "#6E6780",

  surface: "#FFFFFF",
  surfacePage: "#F7F6F9",
  surfaceFill: "#F2F0F5",
  surfaceMap: "#ECE9F0",

  line: "#EEEBF2",
  lineStrong: "#DCD8E2",
  grabHandle: "#D9D5DF",

  success: "#067647",
  successBg: "#ECFDF3",
  warning: "#93370D",
  warningBg: "#FFF6E5",
  danger: "#B42318",
  dangerBg: "#FEF3F2",
  online: "#12B76A",

  // ---- Legacy palette (mirror of colors.scss; do not use in new code) ----
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
  textSubtle: "#B7AECB",
} as const;

/** Spacing scale 4 / 8 / 12 / 16 / 20 / 24 / 32. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  /** small chip */
  sm: 8,
  /** status chip */
  chip: 12,
  /** mobile buttons and inputs, banners */
  md: 14,
  /** cards */
  lg: 16,
  /** bottom-sheet top corners */
  sheet: 24,
  round: 999,
} as const;

/** Minimum touch target on mobile. */
export const touchTarget = 48;

export const shadows = {
  /** floating buttons: 0 2 10 rgba(20,16,24,.16) */
  floating: {
    shadowColor: "#141018",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  /** bottom sheets: 0 -6 24 rgba(20,16,24,.12) */
  sheet: {
    shadowColor: "#141018",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
} as const;

export type FontWeight = 400 | 600 | 700 | 800;

/**
 * Per-weight font families (Android ignores fontWeight on custom fonts).
 * IBM Plex Sans Arabic tops out at 700, so 800 maps to 700.
 */
export const fontFamilies = {
  latin: {
    400: "Manrope_400Regular",
    600: "Manrope_600SemiBold",
    700: "Manrope_700Bold",
    800: "Manrope_800ExtraBold",
  },
  arabic: {
    400: "IBMPlexSansArabic_400Regular",
    600: "IBMPlexSansArabic_600SemiBold",
    700: "IBMPlexSansArabic_700Bold",
    800: "IBMPlexSansArabic_700Bold",
  },
} as const satisfies Record<"latin" | "arabic", Record<FontWeight, string>>;

/** Mobile type scale (size / weight / letter spacing). */
export const typography = {
  /** screen titles */
  display: { fontSize: 32, weight: 800, letterSpacing: -0.6 },
  /** sheet headline */
  title: { fontSize: 26, weight: 800, letterSpacing: -0.4 },
  heading: { fontSize: 20, weight: 800, letterSpacing: 0 },
  /** list-row titles */
  rowTitle: { fontSize: 17, weight: 700, letterSpacing: 0 },
  bodyStrong: { fontSize: 16, weight: 700, letterSpacing: 0 },
  body: { fontSize: 16, weight: 400, letterSpacing: 0 },
  secondary: { fontSize: 14, weight: 400, letterSpacing: 0 },
  label: { fontSize: 14, weight: 600, letterSpacing: 0 },
  caption: { fontSize: 13, weight: 600, letterSpacing: 0 },
  button: { fontSize: 18, weight: 800, letterSpacing: 0 },
} as const satisfies Record<
  string,
  { fontSize: number; weight: FontWeight; letterSpacing: number }
>;

export type TypeVariant = keyof typeof typography;

/**
 * Arabic line height ÷ font size. IBM Plex Sans Arabic's marks reach well
 * past its em box, so Arabic text always carries an explicit line height
 * (display 48, title 39, heading 30, body 24, caption 20 …).
 */
export const ARABIC_LINE_HEIGHT_RATIO = 1.5;

export type Colors = typeof colors;
