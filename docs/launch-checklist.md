# Labby V1 — launch-gate checklist (M15-T6)

Every row must be **Done** before the first public ride. Owner = who acts; Status as of
2026-10-20. "Blocking" rows are SRS gates; the rest are launch hygiene that the V1 scope assumes.

| # | Item | Why (SRS) | Owner | Status |
|---|---|---|---|---|
| 1 | **Self-host OSRM (+ OSM tiles) or move to a paid provider**, load the region's map extract, point `ROUTING_OSRM_URL` (backend) and the apps' `EXPO_PUBLIC_MAP_TILE_URL` and the admin `config.json` `mapTileUrl` at it; re-run the routing smoke (estimate shows a road route, not "approximate") | ES-04, CON-04, ASM-03/04 — **mandatory pre-launch gate**: the public demo server forbids production traffic | Owner (infra) + Claude (config + smoke) | **Blocking — not started** |
| 2 | **FCM production config**: production Firebase project, service-account JSON delivered as `FIREBASE_CREDENTIALS_PATH`/`_JSON` on the server (never in git), production `google-services.json` in the EAS secret for both apps; send a test push to each app | ES-03, ASM-01, NFR-S4 | Owner | Not started (dev project `labby-5cadf` is wired) |
| 3 | **SMS production config**: the gateway phone/app for production, `SMS_GATEWAY_URL` + token in the server env; OTP delivery test on two carriers; wording keeps clear of "verification"/"التحقق" (carrier filter) | ES-01, ASM-02 | Owner | Not started (dev gateway works) |
| 4 | **Secrets audit**: no secret in the repository or its history; production secrets only in server env / EAS secrets | NFR-S4 | Claude | **Done 2026-10-20** — scan of tracked files + history: the SMS token and JWT secret appear nowhere; no `.env`, keystore or `google-services.json` ever committed; the only private-key match is a test that generates a throwaway key |
| 5 | **Production secrets set fresh**: new `JWT_SECRET` (≥ 32 random bytes), DB password, SMS token, Firebase key — none reused from dev | NFR-S1/S4 | Owner | Not started |
| 6 | **TLS everywhere**: HTTPS reverse proxy in front of the backend (API + realtime socket), HSTS; apps and admin `apiBaseUrl` on `https://` | NFR-S1 | Owner (infra) | Not started |
| 7 | **CORS + config**: `CORS_ALLOWED_ORIGINS` = the production admin origin only; admin `config.json` `environment` set; Springdoc API docs disabled in production (`SPRINGDOC_API_DOCS_ENABLED=false`) | NFR-S3 | Owner + Claude | Not started |
| 8 | **Backups live**: nightly `ops/backup/labby-backup.sh` cron on the DB host, `BACKUP_OFFSITE_TARGET` on another machine/provider, `BACKUP_FILES_DIR` set, 30-day retention on both sides, alert on a missing nightly dump | NFR-A2 | Owner (infra) | Not started — scripts + runbook ready: [docs/ops/backups.md](ops/backups.md) |
| 9 | **Restore drill on the production host** into a clean instance (same steps as the dev drill) and record it | NFR-A2 ("tested periodically") | Owner + Claude | Dev drill **Done 2026-10-20** (pass, 23 s — [restore-drill-2026-10-20.md](ops/restore-drill-2026-10-20.md)); production drill not started |
| 10 | **Load test results attached** and re-run on the production server size before launch | NFR-P1/P2/P3 | Claude | Laptop run **Done 2026-10-20** — [load-test-results-2026-10-20.md](load-test-results-2026-10-20.md); production-size re-run not started |
| 11 | **Region legal / compliance** per launch region: transport licensing, privacy regime, driver insurance standards, terms + privacy text reviewed by counsel | ASM-05 | Owner | Not started |
| 12 | **Region configuration complete** in the admin (active region bundle: pricing, cancellation, commission tiers, incentive values **with peak-hour windows**, suspension thresholds, surge zones, emergency number) and **the driver balance floor set in the region's currency scale** — the SRS default −50 is in currency units, so in SYP it blocks a driver after their first cash ride (found by the load test) | ADM-01, DRV-08, COM-03 | Owner (ops) | Not started for production (dev Damascus region exists; its peak bonus has no windows yet; its floor is unset = −50) |
| 13 | **First admin accounts**: Super Admin for the owner, scoped roles for ops/support/finance; remove seeded dev accounts from the production database (production starts empty — dev seeders run only in the `dev` profile) | RBAC-01 | Owner | Not started |
| 14 | **App store builds**: production EAS builds of rider + driver (Android), production `EXPO_PUBLIC_API_BASE_URL`, store listing EN + AR | — | Owner | Not started |
| 15 | **Monitoring**: uptime check on `/api/v1/meta`, disk + DB size alerts, log retention on the server | NFR-A1 | Owner (infra) | Not started |
| 16 | **Design canvas up to date**: paste the approved M14 (20), register (2), M15 analytics (8) and incentives (5) boards from `docs/design/canvas/` into the Design canvas | Design-first rule | Owner | Not started |

## How to use

- Change a row's Status to **Done YYYY-MM-DD** with a link to the evidence (log, screenshot, doc).
- Rows 1–3 and 5–8 are infrastructure the V1 codebase is ready for: each is configuration only
  (no code change) because routing, push, SMS, storage and secrets all sit behind config.
- The OSRM row stays **blocking**: launching on the public demo server breaks its usage policy and
  degrades every estimate to "approximate" when it rate-limits.
