# Labby Admin Dashboard

React + TypeScript + Vite web dashboard for administrators (M1-T3 shell).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

## Scripts

| Script                 | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Vite dev server                                       |
| `npm run build`        | Type-check (`tsc -b`) + production build to `dist/`   |
| `npm run preview`      | Serve the production build locally                    |
| `npm run test`         | Vitest, CI mode (single run)                          |
| `npm run test:watch`   | Vitest in watch mode                                  |
| `npm run lint`         | ESLint (flat config)                                  |
| `npm run format`       | Prettier write                                        |
| `npm run format:check` | Prettier check                                        |
| `npm run check`        | lint + format check + tests (used by the root `make`) |

The root Makefile delegates `admin-check` / `admin-test` / `admin-build` to
`npm run check|test|build` here.

## Runtime configuration

The app is configured at **runtime**, not build time. On boot, `src/main.tsx`
fetches `/config.json` (served from `public/config.json` in dev) **before
rendering anything**, validates it (`src/config/runtime-config.ts`), and hands
it to the app through `ConfigProvider` / `useConfig()`
(`src/config/ConfigContext.tsx`). If the file is missing or invalid, a fatal
error page is rendered instead of a half-configured app.

This means one build artifact is deployable to every environment: a deployment
just ships a different `config.json` (e.g. generated with `envsubst` in a
Docker entrypoint). Build-time `import.meta.env` variables are **not** used
for configuration.

```json
{
  "apiBaseUrl": "http://localhost:8080",
  "environment": "local"
}
```

`src/api/client.ts` is the typed fetch wrapper all future API services build
on; it reads `apiBaseUrl` from the runtime config. No endpoints exist yet.

## i18n & RTL

i18next + react-i18next with bundled EN (`src/i18n/en.json`) and AR
(`src/i18n/ar.json`) resources. The navbar language switcher toggles EN ↔ AR;
an i18next `languageChanged` listener flips `<html dir>` between `ltr`/`rtl`
and persists the choice to `localStorage` (`labby.admin.language`). Layout CSS
uses logical properties, so the chrome mirrors automatically in RTL.

## Theme

`src/theme/tokens.css` is a port of `/assets/theme/colors.scss` (the monorepo
source of truth — keep them in sync). All styling uses `var(--labby-*)`
tokens; components contain no hardcoded colors. Logo images in
`public/images/` are copies of `/assets/images/`.
