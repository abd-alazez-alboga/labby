/**
 * Labby design tokens — TypeScript port for React Native.
 *
 * SOURCE OF TRUTH: /assets/theme/colors.scss (repo root).
 * Any change there must be mirrored here (names map 1:1,
 * `--labby-purple-700` -> `colors.purple700`, etc.).
 * Do not hardcode colors anywhere in the app — always import from this module.
 */

export const colors = {
  // Logo
  logoPurple: '#592D87',
  logoCharcoal: '#231F20',

  // Purples
  purple900: '#3D0B57', // deep, banner gradient start
  purple800: '#430C68', // dark
  purple700: '#59128A', // primary: buttons, banner
  purple600: '#631A95', // mid
  purple500: '#7A2DAE', // button gradient end
  purple450: '#8A2FB3', // bright gradient end
  purple400: '#9B3FC4', // accent

  // Lilacs & lavenders
  lavender300: '#CDBDFF',
  lavender200: '#D9CCFF',
  lilac200: '#E8DCF0', // headline accent
  lilac100: '#EBD8F7', // tags
  lavender100: '#EFE9FF',

  // Backgrounds
  bgTint: '#F5EEF9',
  bgLight: '#FAF7FC',
  white: '#FFFFFF',

  // Text
  text: '#141018',
  textSecondary: '#463C58',
  textMuted: '#6E6780',
  textSubtle: '#B7AECB',
} as const;

/**
 * Gradients from colors.scss. React Native has no CSS gradients;
 * consumers render these as color stop pairs (e.g. with expo-linear-gradient
 * once a ticket needs it) at 135deg.
 */
export const gradients = {
  hero: [colors.purple900, colors.purple700], // --labby-gradient-hero
  button: [colors.purple700, colors.purple500], // --labby-gradient-button
} as const;

/** Spacing scale (RN-only addition; not in colors.scss, which holds colors only). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
} as const;

export type ColorToken = keyof typeof colors;

export const tokens = { colors, gradients, spacing, radius } as const;
