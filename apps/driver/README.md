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

Map tiles (ES-04) follow the same layering: `mapTileUrl` (default `https://tile.openstreetmap.org/{z}/{x}/{y}.png`) and `mapAttribution` (default `© OpenStreetMap contributors`) come from `EXPO_PUBLIC_MAP_TILE_URL` / `EXPO_PUBLIC_MAP_ATTRIBUTION`, then `extra.*` (`LABBY_DRIVER_MAP_TILE_URL` / `LABBY_DRIVER_MAP_ATTRIBUTION`), then the defaults — moving off the public OSM tile servers is config-only.

`src/api/client.ts` is a typed `fetch` wrapper (`apiFetch<T>`) reading that config; the first endpoint consumer arrives with M1-T6. A mobile binary cannot fetch a `config.json` at boot the way the admin web app does — this env/extra layering is the RN equivalent of the runtime-config principle.

## i18n & RTL

- i18next + react-i18next; translations in `src/i18n/translations/{en,ar}.json`.
- Launch order: persisted choice (AsyncStorage, key `labby-driver.language`) → device locale → English.
- Switching language in **Settings** re-renders all strings immediately and flips the JS-level `direction` flag (exposed by `LocaleProvider`, used for text alignment).

**Restart caveat (honest):** native RTL mirroring (row order, back gestures, navigation animations) is controlled by `I18nManager.forceRTL`, which only takes effect after the app restarts — we call it on every switch, so the next launch (or a dev-menu reload) comes up fully mirrored. Until then only the JS-level direction flag is applied. In Expo Go the direction is also shared per-device by the Go container, so prefer a dev build when testing RTL thoroughly.

## Realtime (M6-T4)

Contract: `backend/docs/api/realtime-v1.yaml`.

- **Map** — `components/map/osm-map.tsx` is the reusable map: Leaflet 1.9.4 (unpkg, SRI-pinned) inside `react-native-webview`, so it needs no API key and runs in Expo Go. Props: `center`, `markers` (`kind: 'self'` = own position), optional `route` (contract GeoJSON LineString), `followMe`. The WebView protocol lives in one module (`map/leaflet-bridge.ts`); the only `[lng,lat] → [lat,lng]` conversion is `map/geojson.ts`. Graceful states: spinner until ready, coordinates fallback + retry when Leaflet can't load, a banner when tiles fail.
- **Online/offline** — `realtime/AvailabilityProvider.tsx` (root-level facade) + `components/availability/availability-card.tsx` on home. Location permission is asked before going online (UC-D-04 E3); blocked reasons come from the GET's `cannotGoOnlineReason` (E1); M8's `offersBlockedReason` shows as a banner. Signing out takes an online driver offline first.
- **Location streaming** — `realtime/location-streamer.ts`: WebSocket `ws(s)://<api>/api/v1/realtime` (derived from `apiBaseUrl`), first-frame `auth`, a `location` frame every `streamIntervalSeconds`, re-auth whenever the session token rotates (plus a proactive refresh ~60 s before the JWT `exp`), 4401 → refresh → reconnect, other closes → backoff 1 s…30 s, `ping` every 25 s (no answer in 10 s ⇒ reconnect), unknown frame types ignored, samples buffered while disconnected and flushed with `POST /driver/locations` after the next `ready`.
- **Foreground only (honest caveat)** — fixes come from `watchPositionAsync` while the app is open (`realtime/location-source.ts`). Background tracking needs `startLocationUpdatesAsync` + `expo-task-manager`, the background/"Always" permission and an Android foreground service — i.e. a native dev build. The streamer depends only on the `LocationSource` interface, so a background source plugs in without touching the protocol. The home screen tells the driver to keep the app open while online.
- **Notifications** — center (`/notifications`, `app=driver`, cursor pagination, filter, mark read on open, read-all) and preferences (`/notification-preferences`, `ride`/`safety` locked) for every signed-in account (applicants get their stage updates too). The bell on home and on the driver gate shows the unread badge.
- **Push** — `notifications/push.ts` is the only module touching `expo-notifications`; `notifications/PushBridge.tsx` registers the native device token (`PUT /devices`) after login and on rotation, unregisters it (`DELETE /devices/{token}`) on sign-out, and routes taps through `notifications/deep-links.ts`. **Expo Go cannot receive remote push** (Android support was removed in SDK 53), so registration is skipped there without errors; real FCM delivery needs a dev build plus the Firebase config (M6-T5).

## Battery

What the online stream costs, as the code does it today (`realtime/location-source.ts`, `realtime/location-streamer.ts`, `realtime/AvailabilityProvider.tsx`):

- **GPS is the dominant cost.** `watchPositionAsync` runs at `Accuracy.High` with `timeInterval` = the server's `streamIntervalSeconds` (5 s by default, read from `GET /driver/availability` when the stream starts). Android honours the interval; iOS delivers on its own schedule, and the streamer still sends at most one `location` frame per interval (the latest fix). A later `ready` frame with a different interval re-paces the sends only — the GPS watch keeps its start-time interval until the stream restarts.
- **No distance filter (`distanceInterval: 0`), on purpose.** A waiting, parked driver must keep producing fresh fixes: with a distance filter a stationary driver would get none, go stale after `staleAfterSeconds` (30 s) and drop out of dispatch (TRK-04). The streamer also never resends a fix older than `staleAfterSeconds` — the server sees a silent stream rather than a fake-fresh one.
- **One socket, tiny frames.** A single WebSocket per online session; one small JSON frame per interval; `ping` every 25 s with a 10 s answer timeout (catches half-open mobile connections without chatty keep-alives). Reconnects back off exponentially from 1 s to 30 s with ±20 % jitter, so a dead network does not keep the radio awake. Samples taken while disconnected are buffered (newest 20) and sent in one `POST /driver/locations` batch after the next `ready`.
- **Availability polling is foreground-only.** While online and the app is active, `GET /driver/availability` is re-read every `max(15 s, staleAfterSeconds)` — 30 s with the defaults — plus once on foreground re-entry and once one interval (+2 s) after each (re)connect to confirm the server sees the stream.
- **Everything stops when offline.** The GPS watch, socket, ping and send timers exist only while the server says the driver is online and location is granted; going offline, being taken offline server-side, or signing out tears them all down, and the poll stops with them.
- **Foreground only today.** Fixes come from the foreground watch, so once the OS suspends the app (phone locked, another app in front) the stream goes silent and the driver goes stale after 30 s; the home screen tells the driver to keep the app open while online.
- **Planned: a background `LocationSource`.** It plugs into the existing `LocationSource` seam without touching the protocol code: `Location.startLocationUpdatesAsync` + an `expo-task-manager` task, the background / "Always" location permission, an Android foreground service (with its persistent notification) and iOS `UIBackgroundModes: location`. This needs a native dev build, not Expo Go. Its battery trade-offs (accuracy level, letting the OS batch/defer updates vs. the 5 s freshness the dispatcher needs) are to be decided when it lands.

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
├── api/             # apiFetch/authFetch + typed contract slices (auth, onboarding, regions, realtime)
├── map/             # GeoJSON conversion + the Leaflet WebView bridge
├── realtime/        # availability facade, location streamer + protocol, GPS source
├── notifications/   # deep-link mapper, unread store, push plumbing
├── config/          # typed runtime-ish config accessor
├── i18n/            # i18next init, persistence, RTL sync, LocaleProvider
└── theme/           # tokens.ts — port of /assets/theme/colors.scss
```
