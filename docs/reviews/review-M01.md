# Review — M1 Foundation & Scaffolding (`69a6d01..389e7d7`)
_9 commits · 176 files · reviewed 2026-10-04_

Range note: `69a6d01` (docs/planning + brand assets) is the base and is out of scope; the audited
commits are `3cac267..389e7d7` — four docs/skills commits and the five implementation commits
(T1 `70d739e`, T2 `20644f8`, T3 `d4ff4c4`, T4 `81ae85f`, T5 `1edb89c`, T6 `389e7d7`).
All changed files were read in full. Everything is new code; there is no pre-existing baseline.

## Summary

M1 delivers what it promises: a real backend skeleton (Spring Boot 3.5 / Java 21, Flyway owning the
schema, ArchUnit + Spotless + Checkstyle all genuinely failing the build — the ArchUnit gate was
probe-verified with a deliberate violation in an isolated copy), an admin shell with true
runtime config, i18n/RTL and token-only styling, and two Expo RN shells with the same principles
translated honestly (including a frank, documented `I18nManager.forceRTL` restart caveat). The
backend was booted live against the compose Postgres during this audit: health UP, Swagger 200,
`/api/v1/meta` serving; the admin shell was driven in a real browser and showed live backend data,
the graceful offline state, and a full EN↔AR RTL flip. Two things keep this from a clean pass: an
admin test that is flaky under load (it failed the root `make check` run during this audit), and
the T6 meta smoke call not firing on boot in the rider/driver apps (it fires on the settings
screen instead).

**Verdict:** Pass with comments
**Findings:** Critical 0 · High 2 · Warning 2 · Info 5 · Praise 5

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| **T1** tree matches layout | met | `backend/`, `apps/{rider,driver,admin}/`, root `README.md`, `.gitignore`, `Makefile` all present |
| **T1** `make help` lists targets | met | ran it: lists `check/test/build` + 12 per-project targets |
| **T1** `.gitignore` covers Java, Node, RN, env | met | `/.gitignore` has env/secrets, Maven, Node, Expo/RN, IDE sections |
| **T2** `make check` green | met | `make -C backend check` → 12/12 tests, BUILD SUCCESS (twice: standalone and via root `make check`) |
| **T2** ArchUnit fails on deliberate violation | met | probe in isolated copy: class in `com.labby.backend.web` depending on `MetaController` → 2 rules failed the build (allowlist + no-deps-on-controller) |
| **T2** app boots vs docker-compose Postgres | met | booted `target/backend-0.1.0.jar` against `docker compose up` during audit |
| **T2** `/actuator/health` UP | met | live: `{"status":"UP","groups":["liveness","readiness"]}` |
| **T2** Swagger UI serves | met | live: `/swagger-ui.html` → 200, `/v3/api-docs` → 200 |
| **T3** `npm run build` + tests green | **partial** | build green (tsc + vite, 22s); tests green in isolation but `language-rtl.test.tsx` is flaky — failed in the root `make check` run and 1 of 3 standalone reruns (finding H1) |
| **T3** EN↔AR toggle, full RTL | met | verified in a real browser: `dir=rtl`, `lang=ar`, shell translated, layout mirrored, choice persisted |
| **T3** token variables only, no hardcoded colors | met | `global.css` uses only `var(--labby-*)`; `tokens.css` matches `assets/theme/colors.scss` 1:1 |
| **T3** config at runtime, not build time | met | `main.tsx` fetches `/config.json` before render; validated; fatal page on failure; no `import.meta.env` config |
| **T4/T5** runs on Android emulator + iOS simulator | **partial (owner-accepted)** | not verifiable on this headless machine; owner owes a manual run (tracker records this). Headless proxies pass: `expo export` bundles + `tsc --noEmit` clean in both apps |
| **T4/T5** language toggle with RTL | met (with documented caveat) | tests prove toggle, direction flag, persistence, AR strings; native mirroring needs restart — honestly documented in READMEs, settings screens tell the user |
| **T5** separate app, own icon/label | met | `Labby Driver` / `com.labby.driver` / `labbydriver` scheme, brand assets |
| **T6** all three clients display live data | **partial** | admin verified live in browser ("API v0.1.0" from the running backend). Rider/driver display it only on the settings screen, not on boot as the ticket specifies (finding H2); component tests prove the render in all three |
| **T6** failure = friendly error, not a crash | met | admin verified live (stale pre-backend load showed "API unreachable" with the shell alive); offline-state tests in all three clients |
| **MS** one clone + documented commands bring everything up | met | verified end-to-end this audit; per-project READMEs are thorough (root README staleness: W2) |
| **MS** arch/lint/test gates run and fail on violations | met | ArchUnit probe-verified; Spotless/Checkstyle bound to `verify` with fail-on; ESLint+tests in all clients (typecheck gap: W1) |
| **MS** EN/AR + RTL + branding in all three clients | met | admin live-verified; RN via tests + documented native-restart caveat |
| **MS** tracker updated; review audit passed | met / this report | tracker matches reality exactly (T1–T6 done, T7 in_progress); no drift found |

## Critical

None.

## High

### H1 — Flaky admin test: `language-rtl` fails under load / cold start
- **Category:** tests · **Severity:** High · **Certainty:** High
- **Location:** `apps/admin/src/test/language-rtl.test.tsx:15` ("flips the document to RTL and translates the shell when switching to Arabic")
- **Rationale:** During this audit the test failed the root `make check` run (exit 2) and 1 of 3
  standalone reruns, while passing other runs. The test clicks the language switcher immediately
  after `renderShell()` and then `findByText('تصل لوحة تحكم المشرف في مرحلة لاحقة.')` — the
  lazy-loaded `DashboardPage` chunk (React.lazy + Suspense in `app/App.tsx`) can still be resolving
  when the 1 s default `findByText` timeout expires. A nondeterministic gate silently erodes the
  milestone's core promise that the gates are trustworthy.
- **Fix suggestion:** Await the dashboard content before toggling, exactly as
  `app-shell.test.tsx:21` does:
  `await screen.findByText('The admin dashboard arrives in a later milestone.');` before the
  `user.click(...)`, or pass `{ timeout: 5000 }` to the Arabic `findByText`.

### H2 — Rider/driver do not call the meta endpoint on boot (T6 spec)
- **Category:** integration / srs-conformance · **Severity:** High · **Certainty:** High
- **Location:** `apps/rider/src/screens/settings-screen.tsx:56` and `apps/driver/src/components/settings-screen.tsx:72` (only mounts of `ApiStatus`); `apps/rider/src/app/_layout.tsx` and `apps/driver/src/app/_layout.tsx` make no meta call
- **Rationale:** T6 says "each client calls it on boot and surfaces failure gracefully". The admin
  app complies (`ApiStatus` in the always-mounted sidenav footer, `apps/admin/src/layout/Sidenav.tsx:31`).
  In both RN apps `ApiStatus` exists only on the settings screen, so the smoke call fires when the
  user navigates there, not at startup. The AC sentence ("display live data … friendly error
  state") is satisfiable, but only behind a navigation the ticket did not ask for.
- **Fix suggestion:** Render `ApiStatus` on the home screen (or trigger `getMeta()` from the root
  layout and surface the result), keeping the settings placement if desired.

## Warning

### W1 — TypeScript type checking is not part of any client `check` gate
- **Category:** structure / tests · **Severity:** Warning · **Certainty:** High
- **Location:** `apps/admin/package.json:15` (`check` = lint + format:check + test),
  `apps/rider/package.json:12`, `apps/driver/package.json:13` (`check` = lint + test)
- **Rationale:** `tsc` runs only inside `build` (admin `tsc -b`, rider/driver `tsc --noEmit`), so
  root `make check` never type-checks the clients: ESLint is not type-aware here and vitest/jest
  transpile without checking. A type error can pass every gate the tracker calls "check green".
- **Fix suggestion:** Add typecheck to each `check` script (e.g. driver already has
  `npm run typecheck` — include it: `"check": "npm run lint && npm run typecheck && npm run test"`,
  and the equivalent in admin/rider).

### W2 — Root README "Getting started" is stale
- **Category:** structure (docs drift) · **Severity:** Warning · **Certainty:** High
- **Location:** `README.md:30-37`
- **Rationale:** Still says each section "arrives with M1-T2/T3/T4/T5" although all four landed.
  The root README is the entry point for the milestone AC "one git clone + documented commands";
  today it points at future tickets instead of the four existing sub-project READMEs.
- **Fix suggestion:** Replace the bullets with the actual quick-start (link each sub-project README,
  mention `make backend-check`, `npm install && npm run dev` etc.).

## Info (max 5)

1. `backend/src/main/java/com/labby/backend/config/CorsConfig.java:20` — `allowedOrigins.split(",")`
   without trimming; `CORS_ALLOWED_ORIGINS=a, b` silently breaks the second origin. Trim entries.
2. `backend/src/test/java/com/labby/backend/integration/MetaIntegrationTest.java:28` (and
   `MetaControllerTest`) hardcode `"0.1.0"`; every version bump will touch tests. Assert against
   injected `BuildProperties` instead.
3. `apps/rider/package.json:3` — `"version": "1.0.0"` while backend `VERSION`/`pom.xml`, admin and
   driver all say `0.1.0` (rider `app.config.ts` too). Align to 0.1.0.
4. Driver jest output is noisy: React `act(...)` warning from `ApiStatus` updates and an i18next
   re-init `console.error` in `apps/driver/src/__tests__/` runs. Wrap/flush the async state update
   and init i18n once per suite.
5. `backend/` has no `.githooks/pre-commit` / `make install-hooks` from the PROJECT-STRUCTURE
   template — formatting drift is only caught at `make check`. Acceptable for M1; worth adding.

+1 more nitpick — ask to see it.

## What's good

- **The gates are real, not decorative.** ArchUnit failed a deliberately injected violation in a
  probe (allowlist + controller-dependency rules both fired); Spotless and Checkstyle are bound to
  `verify` with fail-on. This is exactly what NFR-M1 and the milestone story asked for.
- **Admin runtime config done properly:** fetched and validated before first render, typed access
  via context, bilingual fatal-error page, zero build-time config — and the whole chain is tested
  (network error, non-2xx, invalid JSON, missing key).
- **Honest engineering on RN RTL.** Instead of pretending `forceRTL` works instantly, both apps
  expose a JS-level direction flag for immediate feedback, surface the restart caveat to the user
  in both languages, and document it in the READMEs.
- **Token discipline everywhere:** `assets/theme/colors.scss` mirrored 1:1 (values verified) into
  admin `tokens.css` and both RN `tokens.ts`, each declaring the source of truth; no hardcoded
  colors in any shell component; admin uses CSS logical properties so RTL mirrors for free.
- **Clean history and hygiene:** nine short imperative commits, zero attribution, no secrets
  (grep-verified; only documented local-dev defaults), no dead code or debug leftovers found,
  tracker state matches reality exactly.

## Pre-existing (out of scope, non-blocking)

- `assets/images/labby-icon.png` (from base commit `69a6d01`) is 150×150 — below Expo's 1024×1024
  recommendation; driver README already flags that the owner should supply a hi-res master.

## Test run results

All run on this machine during the audit (Docker available; headless — no emulators):

| Command | Result |
|---|---|
| `make -C backend check` (`mvnw verify`) | **green** — 12/12 (7 ArchUnit, 3 integration incl. Testcontainers Postgres, 2 unit), Spotless + Checkstyle pass, BUILD SUCCESS |
| `apps/admin npm run check` | green standalone (15/15, 5 files) — **but flaky**, see H1 |
| `apps/admin npm run build` | green — `tsc -b` + vite build |
| `apps/rider npm run check` | green — 8 tests, 4 suites |
| `apps/driver npm run check` | green — 10 tests, 4 suites (act() warning noise, Info 4) |
| root `make check` | **exit 2** — backend/rider/driver green; admin failed on the H1 flake (`language-rtl.test.tsx`); reruns: 1 fail / 2 pass of 3 |
| ArchUnit violation probe (isolated copy) | gate **fails correctly** — 2 rules violated, build fails |
| Live boot probe | backend vs compose Postgres: health UP, Swagger 200, `/api/v1/meta` → `{"name":"labby-backend","version":"0.1.0"}` |
| Live browser probe (admin) | shows "API v0.1.0" from the running backend; offline state shown when backend absent; EN↔AR flip sets `dir=rtl`/`lang=ar`, mirrors layout, persists choice |

## Re-audit (372a53f)

_Re-audited 2026-10-04 · fix commit `372a53f` ("fix m01 review findings") · HEAD = `372a53f`, working tree clean_

### Finding resolution

| Finding | Status | Evidence |
|---|---|---|
| **H1** flaky admin `language-rtl` test | **resolved** | Both tests in `apps/admin/src/test/language-rtl.test.tsx` now `await screen.findByText('The admin dashboard arrives in a later milestone.')` before interacting, matching the suggested fix. Admin suite run **3×**: 15/15 passed every run (RTL test 620 ms / 641 ms / 865 ms — well inside the window now that the lazy chunk is awaited). |
| **H2** rider/driver meta call not on boot | **resolved** | `ApiStatus` is now mounted on `apps/rider/src/screens/home-screen.tsx:29` and `apps/driver/src/components/home-screen.tsx:36` (settings placement kept). `ApiStatus` fires `getMeta()` in a mount `useEffect`, so the smoke call fires at app boot. Coverage: dedicated `api-status` suites in both apps prove the ok and offline states; the home screen renders with `ApiStatus` mounted in `home-screen.test.tsx` (rider) and `shell.test.tsx` (driver, real route tree), kept deterministic by the new pending-fetch stub in each jest setup. Note: no test asserts `ApiStatus` specifically *on* the home screen — placement is source-verified; a one-line `findByTestId('api-status-…')` in the home tests would lock it in (nitpick, non-blocking). |
| **W1** no typecheck in client `check` gates | **resolved** | `check` now chains typecheck in all three: admin `lint && format:check && typecheck && test` (`typecheck: tsc -b`), rider and driver `lint && typecheck && test` (`tsc --noEmit`). **Probe-verified in scratch copies** (outside the repo, node_modules symlinked, tsbuildinfo removed): a deliberate `const x: number = "not a number"` made `npm run typecheck` exit 2 in admin, rider, and driver. `&&` chaining means `check` fails with it. |
| **W2** stale root README getting-started | **resolved** | `README.md:31-41` now gives the real quick-start; every claim verified: `make backend-check/admin-check/rider-check/driver-check` targets exist in the root Makefile, `db-up`/`run` in `backend/Makefile`, Vite default port 5173, Expo `~57.0.26` in both RN apps, all four sub-project README links resolve. |
| **Info 1** CORS origins not trimmed | **resolved** | `CorsConfig.java:20-21` now maps `String::trim` over the split entries. |
| **Info 2** hardcoded `"0.1.0"` in backend tests | **resolved** | `MetaIntegrationTest` now injects `BuildProperties` and asserts against `getName()`/`getVersion()` — the only test that was coupled to the real version. `MetaControllerTest`/`MetaServiceImplTest` still contain the literal `"0.1.0"`, but only as *mocked stub data* (the mock returns it and the test asserts pass-through), so a version bump cannot break them; no change needed there. |
| **Info 3** rider version 1.0.0 | **resolved** | `apps/rider/package.json` → `0.1.0`; now aligned with backend, admin, driver, and rider `app.config.ts`. |
| **Info 4** driver jest act()/i18next noise | **resolved** | Pending-fetch default stub added in `apps/driver/jest.setup.js` and `apps/rider/jest-setup.ts` (api-status suites override per test via `globalThis.fetch`); driver run shows no `act(...)` warning and no i18next re-init `console.error`. The remaining i18next Locize `console.info` banner is upstream promo output and was not part of the finding. |
| **Info 5** missing `.githooks`/`make install-hooks` | **agreed ignored** | Deliberately not implemented for M1, per the original finding's own assessment ("Acceptable for M1; worth adding") and owner agreement. Recorded here so it is deferred, not silently dropped — revisit when backend tooling is next touched. |

### Fix-commit hygiene

- `372a53f` touches only files tied to the findings above plus this report file itself; no unrelated changes.
- Commit message is short and imperative with **no attribution** of any kind; diff contains no secrets.
- Incidental widening inside the fix: the api-status tests switched `global.fetch` → `globalThis.fetch` so the suite-level stub and per-test overrides compose — in scope for Info 4/H2, behavior-equivalent.

### Test runs (this re-audit, all on this machine)

| Command | Result |
|---|---|
| `apps/admin` suite ×3 (1× `npm run check` incl. new typecheck, 2× `npm run test`) | **green 3/3** — 15/15 tests each run; H1 test no longer flaky |
| `make -C backend check` | **green** — 12/12 (7 ArchUnit, 3 integration incl. Testcontainers Postgres, 2 unit), Spotless + Checkstyle clean, BUILD SUCCESS |
| `apps/rider npm run check` | **green** — lint + `tsc --noEmit` + 8 tests / 4 suites |
| `apps/driver npm run check` | **green** — lint + `tsc --noEmit` + 10 tests / 4 suites, no act() noise |
| root `make check` | **green** — exit 0 across backend + all three clients (previously exit 2 on the H1 flake) |
| Typecheck probe (scratch copies, deliberate type error) | gate **fails correctly** in admin, rider, and driver (exit 2 each) |

Re-audit verdict: Pass
