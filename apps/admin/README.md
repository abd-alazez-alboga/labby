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

## Permissions (RBAC, M3-T3)

UI gating uses the **same `domain:action` permission strings the backend
enforces** (`backend/docs/api/rbac-v1.yaml`, `enums/Permission.java`). The
pattern for every admin screen:

- `usePermissions()` (`src/auth/usePermissions.ts`) — `can('users:view')`
  for menus and controls (the sidenav and all mutating buttons/forms use it).
- `<RequirePermission permission="…">` (`src/auth/RequirePermission.tsx`) —
  wraps each permissioned route; without the permission the 403 page renders.
- `src/api/rbac.ts` — typed calls for the M3 admin/role/audit endpoints.

The signed-in admin's permission set comes from their profile: the active
`admin` role assignment on `GET /users/me` carries `rbacRole` +
`permissions` (M3-T2 backend; absent fields = no permissions, deny by
default). `src/auth/permissions.ts` is the only reader of that shape.

**Propagation of role edits:** the backend evaluates permissions per
request, so a role edit affects every holder's API access instantly. The
UI reads permissions from the profile, which is fetched at login and
re-fetched on every page load — so another admin's screens update **on
their next page refresh**, without re-login. UI gating is cosmetic either
way; the server-side check is the enforcement (RBAC-03).

## Driver review queues (M5-T4)

Built against `backend/docs/api/onboarding-v1.yaml` (`src/api/onboarding.ts`).
Routes `/driver-applications`, `/vehicle-reviews`, `/document-expiries` (+ their
detail pages) need `driver-review:view`; every decision control needs
`driver-review:decide`. Approve/reject always pass an inline confirmation.

- **Private files (NFR-S2):** a `FileRef.url` is resolved against the
  runtime `apiBaseUrl` (`resolveFileUrl`) and loaded without a bearer token
  (`<img src>`; PDFs open in a new tab). URLs expire, so they are never
  cached: `useReviewResource` refetches the owning resource 30 s before the
  earliest `urlExpiresAt` (never sooner than 15 s), and a file that fails to
  load triggers one silent refetch before it is shown as unavailable.
- **409s** carry no machine-readable reason in the contract, so the detail
  pages refetch and explain the current state in plain words (another
  reviewer decided, duplicate plate, document expired, renewal expired).

## Notifications, push and toasts (M6-T4)

Built against `backend/docs/api/realtime-v1.yaml` (`src/api/notifications.ts`).

- **Toasts** (`src/toast/`): `useToast().show({ tone, title?, message, action?, durationMs? })`
  is the shared primitive for event feedback — `info` / `success` / `warning` /
  `error` auto-dismiss (paused on hover/focus; `×` or Escape dismisses), and
  `critical` is sticky until acknowledged (the variant M10 SOS alerts use).
  Two `aria-live` regions (polite; assertive for error/critical) are mounted
  from the first render. Page-state problems (load failures, validation) stay
  inline `.banner`s.
- **Notification center** (`/notifications`, every admin — no permission
  gate): the admin center (`app=admin` → `admin` + `all` audience), newest
  first with cursor paging, category filter, unread markers, mark-read on
  open, mark-all-read. Deep links go through `src/notifications/deep-links.ts`;
  today every catalog screen except `notifications` is driver-only, so they
  open the center (contract rule for unknown screens).
- **Unread badge**: the navbar bell reads `unread-count` on load, on window
  focus / tab visibility and every 60 s while visible, and after reads — the
  center stays accurate without push. New arrivals while the center is open
  show a "show them" pill instead of reshuffling the list.
- **Preferences** (`/notifications/preferences`): per-category push toggles;
  `ride` + `safety` are locked always-on; Save sends only changed categories.
- **Browser push** (`src/push/`): driven by the optional `firebaseWeb` block
  in `config.json` (owner supplies it at M6-T5). Absent → nothing loads and
  no push UI shows. Present → the admin opts in from the preferences page
  (never prompted on load); with permission granted, every signed-in load
  gets the FCM token and `PUT /devices {token, platform:'web', app:'admin'}`,
  and a deliberate logout `DELETE`s it before the session is revoked.
  Foreground pushes become toasts (`safety` → critical). The Firebase SDK is
  only reached through a dynamic import (its own chunk); the worker
  `public/firebase-messaging-sw.js` loads the matching Firebase compat
  scripts from `www.gstatic.com` (a CSP must allow that origin).

```json
{
  "apiBaseUrl": "http://localhost:8080",
  "environment": "local",
  "mapTileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "firebaseWeb": {
    "apiKey": "…",
    "authDomain": "…",
    "projectId": "…",
    "messagingSenderId": "…",
    "appId": "…",
    "vapidKey": "…"
  }
}
```

`mapTileUrl` (optional, default the public OSM tile server) feeds the region
map editor. An incomplete `firebaseWeb` block is ignored with a console
warning — push never blocks the boot.

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
