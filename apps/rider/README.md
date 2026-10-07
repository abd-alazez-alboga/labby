# Labby Rider App

Expo (managed workflow, dev-build compatible) + TypeScript + expo-router. Shell only (M1-T4): navigation, EN/AR i18n with RTL, Labby theme tokens, runtime config pattern, API client base, tests.

## Run it

```bash
npm install
npm start            # Expo dev server (press a = Android, i = iOS, or scan the QR in Expo Go)
npm run android      # start + open Android emulator
npm run ios          # start + open iOS simulator (macOS only)
```

Works in Expo Go; for a dev build use `npx expo run:android` / `npx expo run:ios` (generates the native projects, which are gitignored).

## Scripts

| Script | What it does |
|---|---|
| `npm start` | Expo dev server |
| `npm test` | Jest (jest-expo + Testing Library), CI mode |
| `npm run lint` | ESLint (`eslint-config-expo` flat config) |
| `npm run check` | lint + test (what the root `make check` runs) |
| `npm run build` | Headless CI build: `expo export --platform android` (Metro bundle into `dist/`) + `tsc --noEmit` |

## Configuration

- `app.config.ts` holds app config; `extra.apiBaseUrl` defaults to `http://localhost:8080`.
- Override order (see `src/config/app-config.ts`): `EXPO_PUBLIC_API_BASE_URL` (inlined at bundle time) → `LABBY_API_BASE_URL` (read when the config is evaluated, e.g. `LABBY_API_BASE_URL=... npm start`) → default.
- `src/api/http-client.ts` is the typed fetch base; no endpoints exist yet.
- Map tiles (ES-04): `extra.mapTileUrlTemplate` (default `https://tile.openstreetmap.org/{z}/{x}/{y}.png`) and `extra.mapTileAttribution`; override with `LABBY_MAP_TILE_URL` / `LABBY_MAP_TILE_ATTRIBUTION` (config time) or `EXPO_PUBLIC_MAP_TILE_URL` / `EXPO_PUBLIC_MAP_TILE_ATTRIBUTION` (bundle time). The map (`src/map/`) is Leaflet in `react-native-webview`, so it runs in Expo Go with no API key.
- Push (ES-03): `expo-notifications` registers the native FCM token (`PUT /api/v1/devices`) after sign-in, prompting for the permission once; an unsuccessful registration (permission granted later in Settings, API failure) is retried on foreground re-entry without prompting again. Remote push needs a development build plus the Firebase config: `android.googleServicesFile` reads the `GOOGLE_SERVICES_JSON` env var (an EAS secret file on cloud builds, a local path for `expo run:android`; never committed). Without it there is no FCM, and in Expo Go registration is skipped — the in-app notification center still works.

## Theme

`src/theme/tokens.ts` ports the brand colors 1:1 from `/assets/theme/colors.scss` (repo root), which stays the source of truth. Icon/splash/logo files in `assets/branding/` are copies of `/assets/images/*` — re-copy when brand assets change. Shell styles consume tokens only; no hardcoded colors in screens.

## i18n & RTL (caveat — read this)

- EN + AR catalogues in `src/i18n/translations.ts`; `LocaleProvider` (i18n-js) applies the persisted language (AsyncStorage key `labby.rider.language`) on launch, defaulting to the device language.
- Switching language updates all strings immediately and flips the exposed `isRTL` / `direction` flags, which shell screens use for direction-aware styles (row reversal, text alignment) — so the UI reads correctly right away.
- **Restart caveat:** `I18nManager.forceRTL()` is also called, but React Native only applies the full native layout mirroring **after the app restarts** (in Expo Go: reload the app). The settings screen tells the user this. This is a React Native platform limitation, not something the shell can avoid.

## Tests

`npm test` covers: shell renders (EN strings), language switch flips locale + direction flag + persists to AsyncStorage, persisted language applied on launch, and the typed config accessor defaults/overrides. AsyncStorage uses its official Jest mock (`jest-setup.ts`).
