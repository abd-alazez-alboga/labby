/**
 * Labby design tokens.
 *
 * Color values are ported 1:1 from /assets/theme/colors.scss at the repo
 * root — that file is the SOURCE OF TRUTH for brand colors. If it changes,
 * update this module to match; never edit colors here independently.
 *
 * Spacing / radius / typography scales below are app-level shell tokens
 * (React Native has no SCSS pipeline); they exist so screens never hardcode
 * raw values.
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
 * Gradient stop pairs from colors.scss (CSS linear-gradients have no direct
 * RN equivalent; consumers render them with expo-linear-gradient or a solid
 * fallback — the shell uses the solid primary color until a gradient is
 * actually needed).
 */
export const gradients = {
  hero: [colors.purple900, colors.purple700],
  button: [colors.purple700, colors.purple500],
} as const;

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
  pill: 999,
} as const;

export const fontSize = {
  sm: 13,
  md: 16,
  lg: 20,
  xl: 28,
} as const;

export type Colors = typeof colors;
