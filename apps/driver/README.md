# Labby Driver

React Native (Expo, managed workflow, TypeScript) app for Labby drivers. Shipped with **M1-T5**: navigation shell, EN/AR i18n with RTL, Labby theme tokens, config pattern, API client base, and tests. No business features yet.

- Expo SDK 57 / React Native 0.86 / expo-router
- Display name **Labby Driver** (`com.labby.driver`) — distinct from the rider app

## Run it

```bash
npm install
npm start            # Metro + dev server; press a (Android) or i (iOS), or scan the QR in Expo Go
npm run android      # start and open the Android emulator directly
npm run ios          # start and open the iOS simulator directly (macOS only)
```

Works in Expo Go out of the box. For a dev build instead: `npx expo run:android` / `npx expo run:ios` (generates native projects on first run; they are gitignored).

When running against the local backend from the Android emulator, use `http://10.0.2.2:8080` (the emulator's alias for the host's localhost) — see Configuration below.

## Scripts

| Script | What it does |
|---|---|
| `npm start` | Expo dev server |
| `npm run lint` | ESLint (flat config, `eslint-config-expo`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest (`jest-expo` + Testing Library), CI mode |
| `npm run check` | lint + test (what the root `make check` calls) |
| `npm run build` | typecheck + `expo export --platform android` — a headless, CI-verifiable bundle build into `dist/` |

## Configuration

`src/config/index.ts` exposes `getConfig(): AppConfig`. Resolution order for `apiBaseUrl`:

1. `EXPO_PUBLIC_API_BASE_URL` — env var inlined by Expo at bundle time.
2. `extra.apiBaseUrl` from `app.config.ts`, overridable when the config is evaluated: `LABBY_DRIVER_API_BASE_URL=https://... npm start`.
3. Default `http://localhost:8080`.

`src/api/client.ts` is a typed `fetch` wrapper (`apiFetch<T>`) reading that config; the first endpoint consumer arrives with M1-T6. A mobile binary cannot fetch a `config.json` at boot the way the admin web app does — this env/extra layering is the RN equivalent of the runtime-config principle.

## i18n & RTL

- i18next + react-i18next; translations in `src/i18n/translations/{en,ar}.json`.
- Launch order: persisted choice (AsyncStorage, key `labby-driver.language`) → device locale → English.
- Switching language in **Settings** re-renders all strings immediately and flips the JS-level `direction` flag (exposed by `LocaleProvider`, used for text alignment).

**Restart caveat (honest):** native RTL mirroring (row order, back gestures, navigation animations) is controlled by `I18nManager.forceRTL`, which only takes effect after the app restarts — we call it on every switch, so the next launch (or a dev-menu reload) comes up fully mirrored. Until then only the JS-level direction flag is applied. In Expo Go the direction is also shared per-device by the Go container, so prefer a dev build when testing RTL thoroughly.

## Theme

`src/theme/tokens.ts` is the typed port of `/assets/theme/colors.scss` (repo root — **source of truth**). All shell styles consume tokens; no hardcoded colors in components. CSS gradients from the SCSS are exposed as color-stop pairs (`gradients.hero`, `gradients.button`); the shell uses their start colors as solid fallbacks until a ticket brings in `expo-linear-gradient`.

## Branding

`assets/images/labby-icon.png` and `assets/images/labby-logo-white.png` are copies of `/assets/images/*` (repo root — source of truth; re-copy if the brand changes). Known caveat: the icon master is 150×150 px, below the 1024×1024 Expo recommends, so stores/launchers will upscale it — flagged for the owner to supply a hi-res master.

## Tests

`src/__tests__/` covers: the real expo-router route tree renders the home shell, the language switch changes locale + direction flag + persists, and the config accessor (defaults, env override, trailing-slash cleanup). AsyncStorage uses its official Jest mock (`jest.setup.js`).

## Structure

```
app.config.ts        # Expo config: name/icon/splash, extra.apiBaseUrl
src/
├── app/             # expo-router routes: _layout (stack + i18n boot), index, settings
├── components/      # screen implementations (kept out of app/ so they are unit-testable)
├── api/             # apiFetch wrapper
├── config/          # typed runtime-ish config accessor
├── i18n/            # i18next init, persistence, RTL sync, LocaleProvider
└── theme/           # tokens.ts — port of /assets/theme/colors.scss
```
