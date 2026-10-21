# Review — Live behaviour test, all three apps (2026-10-21)
_Rider (apps/rider), driver (apps/driver) and admin (apps/admin) against the local backend at `1d07dfb` · main flows only (owner-scoped to a 4–5 h window) · report only, nothing fixed_

**Contents:** [Summary](#summary) · [Scope and method](#scope-and-method) · [Scenario results](#scenario-results) · [Findings](#findings) ([Critical](#critical) · [High](#high) · [Warning](#warning) · [Info](#info)) · [V1 retest](#v1-conformance-retest) · [Covered by rulings, environment, not reproduced](#covered-by-rulings-deferrals-or-the-test-environment) · [Environment](#environment) · [Data changed](#data-changed-in-the-local-db) · [Not tested](#what-was-not-tested-and-why)

## Summary

54 main-flow scenarios were clicked live in the real apps on an Android emulator and in the admin dashboard:

| Result | Scenarios |
|---|---|
| PASS | 50 |
| FAIL | 4 |
| BLOCKED | 0 |
| NOT RUN | 1,696 of the 1,750-row matrix (owner descoped the run to main flows, see [Not tested](#what-was-not-tested-and-why)) |

The core loops work end to end with real SMS and real FCM push:
- rider sign-up;
- on-demand ride from offer to cash receipt;
- the wallet ride with a 100 % promo (C2 fixed);
- scheduled claim and T−15 conversion;
- shared ride with per-seat split;
- floor block and settlement;
- suspension and reactivation;
- support ticket;
- SOS to the admin live map;
- report and resolution;
- account deletion and automatic reactivation.

Every number checked on screen matched the stored fare, ledger, wallet and share rows.

The verification wave confirmed one **Critical** defect the static audits never saw: **no photo or file can be uploaded from either mobile app**. Expo SDK 57 replaces `fetch` with `expo/fetch`, which rejects React Native `{uri,name,type}` FormData parts before any request leaves the device. Driver applications, document renewals, vehicle photos and all report and ticket attachments are therefore impossible in-app (L-C1).

The **High** defect: the admin dashboard signs the admin out on a page load once the 15-minute access token has expired (L-H1).

**Verdict:** Fail
**Findings:** Critical 1 · High 1 · Warning 7 · Info 7
_Separately, not counted as gaps: covered by rulings or the environment 9, not reproducible in code 4._

Of the V1 conformance findings retested live, C1, C2, H1, H2, H3, H8, H9, W2, W4, W7, W16, W20, W32, W39, W41 and W43 are **fixed**. W3 and W24 remain only as environment/config items. The rest were not retested ([table](#v1-conformance-retest)).

## Scope and method

1. **Scenario matrix (workflow, 9 read-only agents).**
   - Eight area agents plus one completeness critic built a 1,750-row matrix from the SRS, every use case (main, A*, E*), every milestone AC, the API contract headers, the approved boards and the V1 report.
   - Areas: auth 209, ride 183, driver ops 210, scheduled/shared 238, money/growth 221, trust/comms 229, admin 235, V1 retest + cross-cutting 165, critic gaps 60.
   - It is committed as an appendix under [`live-test-2026-10-21/matrix/`](live-test-2026-10-21/matrix/).
   - The owner then limited the live run to the main flows within 4–5 hours.
2. **Live run (orchestrator, sequential).**
   - One emulator ran the app under test. The counterpart party was a Python API harness calling the same endpoints the apps use, and the roles were swapped so both apps' screens were clicked for the ride loop.
   - Database edits were used only to reach states the UI cannot reach in time: the cancellation grace end and the scheduled pickup time.
   - Every result was observed on screen and screenshotted, 101 images (phones at 540 px).
3. **Verification wave (workflow, 4 read-only agents).** Every FAIL and every observation was root-caused to `file:line`, checked against the rulings, deferrals and approved boards, matched against the V1 report, and severity-calibrated. Only confirmed items are findings below. The rest are listed separately.

## Scenario results

Prefix `R-` = rider app, `D-` = driver app, `A-` = admin. Screenshots are in [`live-test-2026-10-21/`](live-test-2026-10-21/).

| ID | Flow | Result | Evidence | Notes |
|---|---|---|---|---|
| M-01 | Rider registration with real SMS OTP (AUTH-01, UC-S-01) EN | PASS | [R-register-otp-en](live-test-2026-10-21/R-register-otp-en.jpg), [R-register-details-en](live-test-2026-10-21/R-register-details-en.jpg), [R-home-after-register](live-test-2026-10-21/R-home-after-register.jpg) | 0991••••88 entered, stored as +963991••••88 (H3 canonicalization); 60 s resend countdown shown; lands on map home |
| M-02 | No driver found after candidate exhaustion + one-tap Try again (RIDE-08) | PASS | [R-no-driver-en](live-test-2026-10-21/R-no-driver-en.jpg) | single online candidate timed out (15 s) → no_driver_found; Try again re-dispatched |
| M-03 | On-demand ride loop, rider app clicked, harness driver (RIDE-01..06, UC-R-04/05/06) cash | PASS | [R-estimate-en](live-test-2026-10-21/R-estimate-en.jpg), [R-searching-en](live-test-2026-10-21/R-searching-en.jpg), [R-driver-coming-en](live-test-2026-10-21/R-driver-coming-en.jpg), [R-driver-arrived-en](live-test-2026-10-21/R-driver-arrived-en.jpg), [R-in-ride-en](live-test-2026-10-21/R-in-ride-en.jpg), [R-complete-en](live-test-2026-10-21/R-complete-en.jpg), [R-after-rating-en](live-test-2026-10-21/R-after-rating-en.jpg), [R-paid-en](live-test-2026-10-21/R-paid-en.jpg), [R-receipt-en](live-test-2026-10-21/R-receipt-en.jpg) | estimate 3 service types; accept → route line drawn (H9 fixed); vehicle photo shown (W32 fixed); 5:00 free wait; metered 806 m/49 s → 11,857 + min-fare adj 3,143 = 15,000 = fares row; ledger commission_due −3,750 (25%) |
| M-04 | Rider rating 5★ + comment, 7-day window copy (RATE-01) | PASS | [R-complete-en](live-test-2026-10-21/R-complete-en.jpg) | "rate until Oct 28" |
| M-05 | Rider cancels inside grace (RIDE-07) | PASS | [R-cancel-confirm-en](live-test-2026-10-21/R-cancel-confirm-en.jpg), [R-cancelled-free-en](live-test-2026-10-21/R-cancelled-free-en.jpg) | Damascus grace 5 min ("Free until 6:51 PM"); stored cancelled_by_rider, fee null; "You were not charged." |
| M-06 | Rider cancels after grace → fee (RIDE-07, PRC-03) | PASS | [R-cancel-fee-en](live-test-2026-10-21/R-cancel-fee-en.jpg), [R-cancelled-fee-en](live-test-2026-10-21/R-cancelled-fee-en.jpg) | setup: DB grace end → past; quote 5,000 SYP "added to your next ride"; stored fee 5000.00. Banner time showed the pre-edit 6:52 PM (setup artifact, not a defect) |
| M-07 | Admin login (Super Admin) + dashboard renders (AUTH-06, ADM-02) | PASS | [A-dashboard-en](live-test-2026-10-21/A-dashboard-en.jpg) |  |
| M-08 | Admin user search by name (H8 retest) | PASS | [A-users-search-name](live-test-2026-10-21/A-users-search-name.jpg) | "Rider A" → 1 match; was: no match by name |
| M-09 | Admin wallet grant 50,000 SYP + push to rider (PAY-01/03, NTF-01) | PASS | [A-wallet-grant](live-test-2026-10-21/A-wallet-grant.jpg) | wallet 0→50,000, pending due 5,000 visible; real FCM push "Credit added to your wallet" on emulator |
| M-10 | Admin creates promo FREE100 (GRW-01) | PASS | — | start/end are required (browser "Please fill out this field"); uses-per-rider prefilled 1 |
| M-11 | Rider applies promo + pays by wallet, promo covers whole fare (C2 retest, GRW-01, PAY-02) | PASS | [R-promo-applied-en](live-test-2026-10-21/R-promo-applied-en.jpg), [R-wallet-promo-estimate-en](live-test-2026-10-21/R-wallet-promo-estimate-en.jpg), [R-c2-complete-en](live-test-2026-10-21/R-c2-complete-en.jpg), [R-c2-paid-en](live-test-2026-10-21/R-c2-paid-en.jpg) | complete 200 (was 500); fares total 0 = 15,000 − 15,000; due 5,000 collected from wallet; driver ledger commission_due −3,750 + promo_compensation +15,000. Promo card text clipped on estimate sheet (see findings); first Apply tap ignored while keyboard open |
| M-12 | Wallet tip 5,000 within 24 h, 100% to driver (PAY-04) | PASS | [R-tip-sheet-en](live-test-2026-10-21/R-tip-sheet-en.jpg), [R-tip-sent-en](live-test-2026-10-21/R-tip-sent-en.jpg) | suggested 2,000/5,000/10,000; "until Thu Oct 22 6:54 PM"; wallet −5,000, driver ledger tip +5,000 |
| M-13 | Driver-app registration with real SMS OTP, AR (AUTH-01, UC-S-01) | PASS | [D-register-otp-ar](live-test-2026-10-21/D-register-otp-ar.jpg), [D-register-details-ar](live-test-2026-10-21/D-register-details-ar.jpg), [D-after-register-ar](live-test-2026-10-21/D-after-register-ar.jpg) | 0936••••44 (the first driver number 0935••••31 got a code and a resend that expired unused; the owner switched numbers). Lands on "Become a driver" |
| M-14 | Driver application in driver app — profile photo upload (DRV-01, UC-D-01) | FAIL | [D-apply-photo-upload-fail-ar](live-test-2026-10-21/D-apply-photo-upload-fail-ar.jpg) | gallery AND camera upload both show "تعذّر الوصول إلى لبي…" (network error); same file via curl PUT /users/me/photo → 200. Blocks the whole in-app application |
| M-15 | Application tracker "Submitted" (DRV-02, UC-D-03) | PASS | [D-application-submitted-ar](live-test-2026-10-21/D-application-submitted-ar.jpg) | setup: application submitted through API harness because of M-14 |
| M-16 | Admin review: start review → approve with service type Economy (DRV-02/03, UC-A-03) | PASS | [A-application-approved](live-test-2026-10-21/A-application-approved.jpg) | all items Approved, vehicle Active; service-type checkboxes have no accessible name ("on") |
| M-17 | Driver app after approval → home, go online, location shared (DRV-05, TRK-01) | PASS | [D-approved-ar](live-test-2026-10-21/D-approved-ar.jpg), [D-online-ar](live-test-2026-10-21/D-online-ar.jpg) | home region line lists all 3 service types though only Economy approved (observation O13) |
| M-18 | Offer → accept on driver app within 15 s (RIDE-03) | PASS | [D-offer-ar](live-test-2026-10-21/D-offer-ar.jpg), [D-accepted-ar](live-test-2026-10-21/D-accepted-ar.jpg) | first attempt expired (tester too slow → correct timeout → no_driver_found) |
| M-19 | Arrive refused outside 100 m geofence (RIDE-04) | PASS | [D-arrive-refused-ar](live-test-2026-10-21/D-arrive-refused-ar.jpg) | "أنت على بعد 268 م. اقترب لمسافة 100 م…"; stale banner persists after moving inside the fence |
| M-20 | Chat quick reply driver→rider (CHAT-01/02) | PASS | [D-chat-ar](live-test-2026-10-21/D-chat-ar.jpg) | delivered to rider thread (harness GET) |
| M-21 | Arrive inside fence → wait timer, no-show disabled 4:56 (RIDE-04, PRC-03) | PASS | [D-arrived-ar](live-test-2026-10-21/D-arrived-ar.jpg) |  |
| M-22 | Start → end → cash collect → trip earnings (RIDE-06, COM-01) | PASS | [D-end-confirm-ar](live-test-2026-10-21/D-end-confirm-ar.jpg), [D-after-cash-ar](live-test-2026-10-21/D-after-cash-ar.jpg) | 10,000+2,538+235+2,227=15,000 = fares row; ل.س label (W20 fixed in driver); ledger commission_due −3,750, balance −3,750 |
| M-23 | Driver rates rider 4★ (RATE-01) | PASS | [D-rate-rider-ar](live-test-2026-10-21/D-rate-rider-ar.jpg) |  |
| M-24 | Floor block after cash commission (COM-03) | PASS | [D-floor-blocked-ar](live-test-2026-10-21/D-floor-blocked-ar.jpg) | blocks at −3,750 vs floor −50 (seeded Damascus floor — O16) |
| M-25 | Admin records settlement pay-in → driver unblocked live (COM-04) | PASS | [A-settlement-recorded](live-test-2026-10-21/A-settlement-recorded.jpg), [D-unblocked-ar](live-test-2026-10-21/D-unblocked-ar.jpg) | preview "balance SYP 0 — above the floor"; ledger +3,750; driver app back to online home without reload |
| M-26 | Driver sets weekly availability (all-day Wed) (DRV-05) | PASS | [D-availability-ar](live-test-2026-10-21/D-availability-ar.jpg) | availability_windows row saved |
| M-27 | Rider schedules: <30 min refused, 30+ min booked, "priced at ride time" (RIDE-S1) | PASS | [R-schedule-time-en](live-test-2026-10-21/R-schedule-time-en.jpg), [R-schedule-too-soon-en](live-test-2026-10-21/R-schedule-too-soon-en.jpg), [R-schedule-estimate-en](live-test-2026-10-21/R-schedule-estimate-en.jpg), [R-scheduled-booked-en](live-test-2026-10-21/R-scheduled-booked-en.jpg) | "That's too soon to schedule" sheet with Book now / Pick another time |
| M-28 | Driver claims on board (RIDE-S2) | PASS | [D-claim-board-ar](live-test-2026-10-21/D-claim-board-ar.jpg), [D-claim-confirm-ar](live-test-2026-10-21/D-claim-confirm-ar.jpg) | pickup/destination labels show English data ("Current location", "Pinned location") in the AR app (O18) |
| M-29 | Conversion at T−15 → live accepted ride on driver app (RIDE-S3) | PASS | [D-converted-home-ar](live-test-2026-10-21/D-converted-home-ar.jpg) | setup: scheduled_at → now+14 min; converted within 30 s. Driver app stayed on the board until navigated home; in-ride map showed "الخريطة غير متاحة" (O19) |
| M-30 | Converted ride arrive → start → complete → cash (RIDE-S3, RIDE-06) | PASS | [D-sched-collect-ar](live-test-2026-10-21/D-sched-collect-ar.jpg) | completed / paid_cash |
| M-31 | Rider scheduled list reflects claim/conversion (RIDE-S2 'claiming notifies rider', UC-R scheduled) | FAIL | [R-scheduled-stale-en](live-test-2026-10-21/R-scheduled-stale-en.jpg) | card stays 'Waiting for a driver' after claim+conversion+completion, pull-to-refresh no effect; API returns [] |
| M-32 | Rider support ticket with attachment (SUP-01, UC-S support) | FAIL | [R-ticket-attach-en](live-test-2026-10-21/R-ticket-attach-en.jpg) | "Couldn't add that file. Please try again." — same upload failure as M-14 (both apps); ticket sent without attachment |
| M-33 | Ticket lifecycle open → in_progress + admin reply visible to rider (SUP-02) | PASS | [R-ticket-sent-en](live-test-2026-10-21/R-ticket-sent-en.jpg), [A-ticket-reply](live-test-2026-10-21/A-ticket-reply.jpg), [R-ticket-reply-en](live-test-2026-10-21/R-ticket-reply-en.jpg) | reply shows after reopening the ticket (screen not live); push "Support replied" arrived ~2 min later |
| M-34 | Admin session survives page reload (AUTH-02 token refresh) | FAIL | — | reproduced twice: a full page load >15 min after login lands on /login (access TTL 900 s; refresh not used on boot) |
| M-35 | Admin suspends rider role → rider app suspended screen with reason/date + push (USR-04/06) | PASS | [R-suspended-en](live-test-2026-10-21/R-suspended-en.jpg) | admin page kept showing "Active" until reload (O23) |
| M-36 | C1 retest: suspended rider cannot book scheduled or create shared ride | PASS | harness.log 20:00 | POST /scheduled-rides 403 rider_suspended; POST /shared-rides 403 rider_suspended (rider app offers no booking UI while suspended) |
| M-37 | Admin reactivates rider role → app back to home live + push (USR-06) | PASS | [A-reactivate-stale](live-test-2026-10-21/A-reactivate-stale.jpg) | admin page stale again ("Suspended") until reload (O23) |
| M-38 | Rider creates shared ride (Economy, 4 seats, party 1, at a time) (RIDE-P1) | PASS | [R-shared-browse-en](live-test-2026-10-21/R-shared-browse-en.jpg), [R-shared-create-en](live-test-2026-10-21/R-shared-create-en.jpg), [R-shared-published-en](live-test-2026-10-21/R-shared-published-en.jpg) | copy "Per seat if 1 ride" / "if 3 ride" reads broken (O24) |
| M-39 | Second rider joins party 2 → creator screen live "3 of 4" (RIDE-P2) | PASS | [R-shared-joined-en](live-test-2026-10-21/R-shared-joined-en.jpg) |  |
| M-40 | Join with party 2 when 1 seat left refused (RIDE-P2) | PASS | harness.log 20:03 | 409 insufficient_seats, details.seatsLeft 1 |
| M-41 | Creator "Start now" → dispatch → accepted (RIDE-P3) | PASS | [R-shared-accepted-en](live-test-2026-10-21/R-shared-accepted-en.jpg) |  |
| M-42 | Rider SOS during ride → dialer 112 + sos_events row + admin live-ops banner/pin/card (SAFE-01) | PASS | [R-sos-confirm-en](live-test-2026-10-21/R-sos-confirm-en.jpg), [R-sos-dialer-en](live-test-2026-10-21/R-sos-dialer-en.jpg), [A-liveops-sos](live-test-2026-10-21/A-liveops-sos.jpg) | Acknowledge saved (acknowledged_at set) but card still showed "Open" right after click (O25) |
| M-43 | Shared completion split per seat (RIDE-P4) | PASS | [R-shared-receipt-en](live-test-2026-10-21/R-shared-receipt-en.jpg) | 15,000 ÷ 3 = 5,000; members: creator 5,000, party-2 member 10,000 = shared_ride_members.share_amount |
| M-44 | H1 retest: account deletion refused during an active ride (UC-S-07 E1) | PASS | [R-delete-during-ride-en](live-test-2026-10-21/R-delete-during-ride-en.jpg), [R-delete-code-en](live-test-2026-10-21/R-delete-code-en.jpg), [R-delete-refused-active-ride-en](live-test-2026-10-21/R-delete-refused-active-ride-en.jpg) | real 2FA SMS to 0991••••88; "Your account cannot be deleted right now (for example during an active ride…)"; users.state stays active. First "Send confirmation code" tap showed no countdown (button stuck "busy" in a11y); second tap worked |
| M-45 | Super Admin creates Support admin → set-password SMS (H2 retest, UC-A-01, AUTH-06) | PASS | [A-admin-created](live-test-2026-10-21/A-admin-created.jpg), [A-set-password-done](live-test-2026-10-21/A-set-password-done.jpg) | owner number 0935••••31; /set-password: code → new password → "Password set. Sign in…" |
| M-46 | Support role RBAC: nav, pages, API (RBAC-03/04) | PASS | [A-support-regions-readonly](live-test-2026-10-21/A-support-regions-readonly.jpg) | nav hides Transactions/Promotions/Challenges/Ledgers/Help center/Applications/Admins; /transactions and /admins → "403 No access"; API GET /admin/transactions, /admin/admins, /admin/promos → 403; /admin/users 200; Regions list read-only |
| M-47 | Driver cancels accepted ride (reason) → rider re-dispatched, no driver → "No driver available" (RIDE-07, rides contract t11) | PASS | [R-driver-cancelled-en](live-test-2026-10-21/R-driver-cancelled-en.jpg) | cancelled_by_driver + redispatch ride no_driver_found |
| M-48 | Rider language switch EN→AR, RTL reload, pending rating prompt in AR (NFR-I1, RATE-01) | PASS | [R-settings-ar](live-test-2026-10-21/R-settings-ar.jpg), [R-home-ar](live-test-2026-10-21/R-home-ar.jpg) | Western digits; Latin data labels "Pinned location" (O18) |
| M-49 | Rider history filters All/Completed/Cancelled/Scheduled/Shared + date (W41 retest, UC-R-16) | PASS | [R-history-ar](live-test-2026-10-21/R-history-ar.jpg), [R-history-cancelled-ar](live-test-2026-10-21/R-history-cancelled-ar.jpg) | Cancelled filter lists no-driver/driver/rider cancels; fee 5,000 ل.س shown; shared shows own share 5,000 |
| M-50 | Driver earnings week + trip detail with route map (W43 retest, UC-D-15) | PASS | [D-earnings-ar](live-test-2026-10-21/D-earnings-ar.jpg), [D-trip-detail-ar](live-test-2026-10-21/D-trip-detail-ar.jpg) | 2 trips, fares 30,000, commission −7,500, balance −3,750 (after +3,750 settlement); tier hint "101 trips → 20%" |
| M-51 | Driver reports rider from a past trip (REP-01, W43) | PASS | [D-report-sent-ar](live-test-2026-10-21/D-report-sent-ar.jpg) | stored inappropriate_behavior/open; "Under review" in Your reports |
| M-52 | Support admin resolves report unsubstantiated with notes (REP-02, RBAC-04) | PASS | [A-report-investigate](live-test-2026-10-21/A-report-investigate.jpg) | investigation shows route, timeline, chat log; DB status unsubstantiated; page kept "Open" after submit (O23 pattern) |
| M-53 | Account deletion with real 2FA SMS (USR-07, AUTH-05) AR | PASS | [R-delete-ar](live-test-2026-10-21/R-delete-ar.jpg), [R-deleted-ar](live-test-2026-10-21/R-deleted-ar.jpg) | users.state deleted; app signs out with "تم حذف حسابك"; password login → 401 |
| M-54 | Re-register deleted phone → automatic reactivation, history/wallet kept (USR-07) | PASS | [R-reregister-ar](live-test-2026-10-21/R-reregister-ar.jpg), [R-reactivated-ar](live-test-2026-10-21/R-reactivated-ar.jpg), [R-wallet-after-reactivate-ar](live-test-2026-10-21/R-wallet-after-reactivate-ar.jpg) | "مرحبًا بعودتك!" → login with old password works; wallet still SYP 40,000 (API). labbyrider://wallet deep link did not open the wallet screen |

## Findings

### Critical

#### L-C1 — No photo or file upload works from either mobile app (Expo `fetch` rejects RN FormData parts)

| | |
|---|---|
| **Category** | correctness / integration |
| **Certainty** | Confirmed. Reproduced live from gallery and camera in both apps; root cause traced in the Expo runtime. |
| **Location** | `apps/driver/node_modules/expo/src/winter/runtime.native.ts:41-53` · `apps/driver/node_modules/expo/src/winter/fetch/convertFormData.ts:68-78` · `apps/driver/src/api/auth.ts:189-199` · `apps/driver/src/api/onboarding.ts:34-41` · `apps/driver/src/api/trust.ts:50-52` · `apps/driver/src/api/support.ts:76-78` · `apps/rider/src/api/support.ts:279-286` · `apps/rider/src/api/auth.ts:286-288` · `apps/rider/src/api/trust.ts:135-137` · `apps/driver/src/components/onboarding/steps.tsx:91-118` · `apps/rider/src/screens/support/ticket-create-screen.tsx:61-67,168-183` |
| **Scenarios** | M-14 (FAIL), M-32 (FAIL), [D-apply-photo-upload-fail-ar](live-test-2026-10-21/D-apply-photo-upload-fail-ar.jpg), [R-ticket-attach-en](live-test-2026-10-21/R-ticket-attach-en.jpg) |
| **New** | Yes. Not in the V1 report; no ruling covers it. |

**Rationale.** Expo 57's winter runtime replaces `globalThis.fetch` with `expo/fetch` unless `EXPO_PUBLIC_USE_RN_FETCH` is set, and nothing in `apps/` sets it.
- Both apps build multipart parts as plain `{uri, name, type}` objects.
- `convertFormData.ts:77` throws "Unsupported FormDataPart implementation" for such parts before any socket opens. That is why the backend logs nothing, while the same JPEG via curl returns 200/201.
- The throw is a plain `Error`, so the driver shows `onboarding.errors.network` ("تعذّر الوصول إلى لبي…") and the rider shows "Couldn't add that file".
- The runtime file is native, not dev-only, so release builds on real phones are affected too. Jest mocks `fetch`, so no test reaches the real body conversion.

**Impact.** No new driver can submit an application, because the profile photo is required. Drivers cannot upload documents or vehicle photos, or renew expiring documents. Riders and drivers cannot attach photos to reports, tickets or lost-item cases. The rider profile photo cannot be changed.

**Fix suggestion.** Pick one:
- (a) build each part from a real file object `expo/fetch` can read, e.g. `new File(uri)` from `expo-file-system`;
- (b) set `EXPO_PUBLIC_USE_RN_FETCH=1` in both apps.

Either way, centralise multipart building in one helper per app, and add a test that runs the FormData through Expo's `convertFormDataAsync`.

### High

#### L-H1 — Admin is signed out on a page load after the access token expires (stale refresh-token replay)

| | |
|---|---|
| **Category** | correctness / auth |
| **Certainty** | Confirmed. Reproduced twice (page loads ~20 and ~45 min after sign-in landed on `/login`); root cause in code. |
| **Location** | `apps/admin/src/api/authedClient.ts:31,46,59-61` · `apps/admin/src/auth/AuthContext.tsx:60,136-155` · `apps/admin/src/auth/session.ts:5,20` · `backend/src/main/java/com/labby/backend/service/AuthServiceImpl.java:167-178` |
| **Scenarios** | M-34 (FAIL) |
| **New** | Yes |

**Rationale.** On a full page load, several providers fire in parallel with the same expired access token: profile, SOS alerts, notifications, trust counts, push registration and the page fetch.
- The refresh is single-flight only while it is in flight, because `refreshInFlight` resets in `.finally`.
- A request whose 401 arrives after the first refresh settled calls `refreshOnce` with the refresh token it captured earlier, which has already been rotated.
- The backend treats that as refresh-token reuse and revokes the whole family (`AuthServiceImpl.java:167-178`), so the admin is logged out.
- AUTH-02 / NFR-S1 promise token sessions with refresh rotation. In practice an admin is thrown out after every 15-minute idle reload.

**Fix suggestion.**
1. In `authedClient.execute`, after a 401, compare the stored tokens with the captured ones. If they have already rotated, retry with the current access token instead of refreshing again.
2. Add a unit test with two parallel 401s where the second resolves after the first refresh.

### Warning

| ID | Finding | Category · Certainty | Location | Scenarios | Fix suggestion |
|---|---|---|---|---|---|
| L-W1 | **Rider scheduled list goes stale.** It stays "Waiting for a driver" after claim → conversion → completion. It refreshes only on focus: no realtime subscription and no RefreshControl, so pull-to-refresh does nothing while `GET /scheduled-rides` returns `[]`. The detail screen does subscribe. | correctness · confirmed | `apps/rider/src/screens/scheduled/scheduled-rides-screen.tsx:89-104,122`; contrast `scheduled-ride-screen.tsx:52-85` | M-31 (FAIL), [R-scheduled-stale-en](live-test-2026-10-21/R-scheduled-stale-en.jpg) | Refetch on ride/claim/conversion realtime events and app foreground; add a RefreshControl. |
| L-W2 | **Rider sends localized UI strings as place labels.** "Current location" / "Pinned location" are stored on the ride, so the Arabic driver app, the admin and receipts show English text. The contract allows `label: null`, and the driver app already localizes a null label. | i18n · confirmed | `apps/rider/src/screens/ride/route-planner.tsx:128-131,210,435-439`; `apps/rider/src/screens/shared/shared-rides-screen.tsx:196`; `backend/docs/api/rides-v1.yaml:861`; `apps/driver/src/rides/format.ts:87` | M-28, M-48, [D-claim-board-ar](live-test-2026-10-21/D-claim-board-ar.jpg), [R-history-ar](live-test-2026-10-21/R-history-ar.jpg) | Send `null` for current-location and pin points; localize at display time in each client. |
| L-W3 | **Estimate and receipt maps are not framed to the route.** There is one `fitBounds` at page init, before the WebView has its final size, with no `invalidateSize` or refit; markers are not in the bounds. The estimate showed a zoomed-in random spot; the receipt showed an over-zoomed segment. | UX · confirmed | `apps/rider/src/map/map-bridge.ts:162-163,196-203`; `apps/rider/src/map/labby-map.tsx:121-133`; `booking-screen.tsx:549-556`; `receipt-screen.tsx:159-165,363-365` | M-03, M-11, [R-estimate-en](live-test-2026-10-21/R-estimate-en.jpg), [R-receipt-en](live-test-2026-10-21/R-receipt-en.jpg) | `invalidateSize()` then `fitBounds(route ∪ markers)` on ready and on container resize. The driver trip-detail map frames correctly ([D-trip-detail-ar](live-test-2026-10-21/D-trip-detail-ar.jpg)). |
| L-W4 | **English rider sentence flips RTL around an Arabic driver name.** It renders ".is waiting at Current location عمر". Names are interpolated without FSI/PDI, and AppText sets no `writingDirection` in LTR. The same applies to "Tip عمر" and "Report عمر". | i18n · confirmed | `apps/rider/src/screens/ride/ride-view.tsx:765-768`; `apps/rider/src/i18n/ride-translations.ts:137`; `apps/rider/src/components/ui/text.tsx:93-105,117-118` | M-03, [R-driver-arrived-en](live-test-2026-10-21/R-driver-arrived-en.jpg) | Wrap interpolated names and place labels in U+2068…U+2069, or set `writingDirection:'ltr'` in LTR. |
| L-W5 | **Promo "Apply" needs two taps while the keyboard is open.** The PromoRow modal is a React child of a ScrollView with the default `keyboardShouldPersistTaps="never"`. | UX · confirmed | `apps/rider/src/screens/ride/booking-screen.tsx:571`; `apps/rider/src/screens/growth/promo-row.tsx:183-230`; same in `schedule-screen.tsx`, `shared-create-screen.tsx`, `shared-ride-screen.tsx` | M-11 | `keyboardShouldPersistTaps="handled"` on the hosting ScrollViews. |
| L-W6 | **Driver is not taken to the converted ride.** A driver on the Scheduled board is not moved to the live ride when the claimed ride converts. The foreground `scheduled.converted` push only resyncs; only a notification tap routes. | correctness · confirmed | `apps/driver/src/notifications/PushBridge.tsx:160-173`; `apps/driver/src/notifications/deep-links.ts:150-151,199-201`; UC-D-12; `scheduled-shared-v1.yaml:155-156` | M-29, [D-converted-home-ar](live-test-2026-10-21/D-converted-home-ar.jpg) | Navigate home/ride after the resync when a converted active ride appears. |
| L-W7 | **Open ticket thread never refreshes when support replies.** The reply appears only after leaving and reopening; the "Support replied" push arrived about 2 minutes later. | UX · confirmed | `apps/rider/src/screens/support/ticket-thread-screen.tsx:104-118` | M-33, [R-ticket-reply-en](live-test-2026-10-21/R-ticket-reply-en.jpg) | Reload on a support push for this ticket while the screen is open, and on focus/foreground. |

### Info

| ID | Finding | Location | Scenarios | Fix suggestion |
|---|---|---|---|---|
| L-I1 | **Rider splash logo cut off at boot** (owner report). `labby-icon.png` is edge-to-edge artwork and the Android 12+ splash circle-masks it. | `apps/rider/app.config.ts:53-58`; `apps/rider/assets/branding/labby-icon.png` | owner report | Asset with transparent padding inside the ~2/3 safe circle; rebuild the dev client. |
| L-I2 | **Driver splash logo cut off at boot** (owner report). The 851×152 wordmark at 220 dp is clipped by the Android 12+ splash circle. | `apps/driver/app.config.ts:86-91` | owner report | Square white mark at about 120–150 dp, like the rider app. |
| L-I3 | **Arabic OTP hint shows "0935••••31+."** The phone isolate is ineffective because the driver AppText never sets `writingDirection:'rtl'`. The rider app does, and renders correctly. | `apps/driver/src/components/ui/text.tsx:54-69`; `apps/driver/src/components/auth/register-screen.tsx:210-212`; `ar.json:71` | M-13, [D-register-otp-ar](live-test-2026-10-21/D-register-otp-ar.jpg) | Mirror the rider Text style. |
| L-I4 | **Outside-geofence banner keeps the stale distance** (268 m) after the driver moves inside the fence, until the next tap. | `apps/driver/src/rides/DriverRideProvider.tsx:694-713`; `apps/driver/src/components/ride/ride-sheets.tsx:180-195` | M-19, M-21 | Clear the error on a newer position. |
| L-I5 | **"Change destination" label truncated** to "Change destina…" (two flex buttons with 20 px padding). | `apps/rider/src/screens/ride/ride-view.tsx:886-899,1163-1166`; `buttons.tsx:76-82,160-167` | M-03, [R-in-ride-moving-en](live-test-2026-10-21/R-in-ride-moving-en.jpg) | Less padding, two lines or shorter copy (check RiderInRide). |
| L-I6 | **Promo chip cut at the bottom of the scrollable options area** on the estimate sheet; the "≈ −SYP … on this estimate" line is hidden below the fold with no scroll hint. | `apps/rider/src/screens/ride/booking-screen.tsx:571,699-719,830-832`; `promo-row.tsx:236-279` | M-11, [R-promo-applied-en](live-test-2026-10-21/R-promo-applied-en.jpg) | Pin the chip with the payment block, or show a scroll affordance. |
| L-I7 | **"Per seat if 1 ride"** has no singular form (`shared.perSeatIf` bypasses `countKey`); the n ≥ 2 copy is board-approved. | `apps/rider/src/i18n/m12-translations.ts:151,370`; `shared-ride-screen.tsx:614-619` | M-38, [R-shared-published-en](live-test-2026-10-21/R-shared-published-en.jpg) | Plural keys via `countKey`; owner proofreads. |

## V1 conformance retest

| V1 finding | Result | Evidence |
|---|---|---|
| C1 suspended account books scheduled/shared | **fixed** (rider-role suspension: scheduled 403, shared 403 `rider_suspended`; the whole-account variant was not retested) | M-36 |
| C2 100 % promo wallet ride cannot complete | **fixed** | M-11 |
| H1 deletion has no active-ride gate | **fixed** for the active-ride gate (debt gate not retested) | M-44 |
| H2 new admin cannot set a password | **fixed** | M-45 |
| H3 phones not canonicalized | **fixed** (`09…` stored as `+963…`; a duplicate in another format was not retried) | M-01, M-13 |
| H4 config edit changes in-flight fare | not retested | — |
| H5 incentives attribute ratings | not retested (incentives screen not opened) | — |
| H6 earnings 500 after two shared tips | not retested | — |
| H7 floor-blocked driver claims scheduled rides | not retested (the blocked driver was not shown a claimable ride) | — |
| H8 admin search by name | **fixed** | M-08 |
| H9 rider map has no route line | **fixed** | M-03 |
| W2 names clipped in AR rider strings | **fixed** (AR rating title and report label render fully) | M-48 |
| W3 floor not currency-scaled | **environment**: code fixed (per-region field); the local Damascus row predates the seeder change, so the effective floor is −50 SYP (see covered list) | M-24 |
| W4 profile lacks reports made / driver ledger | **fixed** (admin "Reports made" card + Driver ledger tab) | M-09, M-25 |
| W7 no language switch for signed-out driver | **fixed** | [D-welcome-ar](live-test-2026-10-21/D-welcome-ar.jpg) |
| W16 admin cannot open SOS-linked ticket | **fixed** (entry point visible: "Open support ticket" on the SOS card; not clicked) | M-42 |
| W20 AR amounts show SYP | **fixed** (ل.س in driver and rider AR) | M-22, M-49 |
| W24 debug rows in Settings | **environment**: still visible in the dev build, `__DEV__`-gated | [R-settings-ar](live-test-2026-10-21/R-settings-ar.jpg) |
| W32 rider never sees vehicle photo | **fixed** | M-03 |
| W39 suspended rider sees raw reason enum | **fixed** (reason text, date, Contact support) | M-35 |
| W41 history has no filters | **fixed** | M-49 |
| W43 report rider only from rating prompt | **fixed** (trip detail + Report rider) | M-50, M-51 |
| All other W1–W43 | not retested (outside the main-flow scope) | — |

## Covered by rulings, deferrals or the test environment

These were observed live but are not counted as gaps.

| Item | Why it is not a gap |
|---|---|
| Admin and driver welcome use a drawn purple "L" square, not the logo asset (owner question) | **Covered.** The owner-approved boards draw exactly this mark: admin sidebar boards, V1FDriverSignedOutLanguage(.Ar), and `docs/design/design-system.md:84`. It does conflict with SRS §1.4, which names the `assets/images/` logo. **Owner decision:** to use the real logo, amend the boards first (design-first rule), then `apps/admin/src/layout/BrandMark.tsx` and `apps/driver/src/components/auth/welcome-screen.tsx:45-66`. |
| "Route preview (dev)", "Backend version", "Layout direction" (owner question) | **Environment.** `__DEV__`-gated (`apps/rider/src/screens/home-screen.tsx:377`, `settings-screen.tsx:283,417`). They appear because the emulator runs the development build; release builds hide them (V1 W24/I96/I36). |
| Driver home region line lists all region service types | **Covered** by approved boards DriverOffline / D12Home and ruling I70 (region line keeps services, drops currency). Showing only the driver's approved types would be a new owner decision. |
| Pending carried due not shown on the estimate sheet | **Covered.** The approved choose-ride boards have no due line; the due is disclosed on the cancel sheet and the wallet (M8 rulings). |
| Damascus floor −50 SYP blocks a new driver after one cash ride | **Environment / launch item.** The seeder now sets −500,000, but the local Damascus row predates it (`DevRegionSeeder.java:76-80`); the production value is launch-checklist item 12 (W3 ruling). |
| Driver app registers no FCM token | **Environment.** The prebuilt driver dev client has no `google-services.json` (`apps/driver/android/app/`), so `getDevicePushTokenAsync` fails silently (`push.ts:164-183`). Production FCM config is DEF-M15-3. Rider push worked with real FCM throughout. |
| Driver in-ride map "Map unavailable" | **Environment.** The designed fallback when Leaflet from unpkg does not load in 15 s (RUL-M6-1, NFR-A3). |
| Delete-account button stays "busy" on the first tap | **Environment.** It waits for the synchronous SMS gateway call. Side note: the SMS RestClient has no connect/read timeout (`SmsGatewaySender.java:25-46`). |
| Expo "Tools" bubble overlaps RTL back/settings buttons | **Environment.** Dev-client overlay only. |

**Observed but not reproducible in code** (the verifier found correct refresh paths and tests; the screenshots may have been taken before the response landed; re-test by hand before acting):
- Admin user trust page showing the old role state after Suspend/Reactivate ([A-suspend-stale-active](live-test-2026-10-21/A-suspend-stale-active.jpg), [A-reactivate-stale](live-test-2026-10-21/A-reactivate-stale.jpg)).
- Report detail still "Open" after Resolve ([A-report-investigate](live-test-2026-10-21/A-report-investigate.jpg)).
- Live-ops SOS card still "Open" after Acknowledge.
- Service-type checkboxes named "on": a tool artefact; they are correctly labelled.
- `labbyrider://wallet` not navigating: the route exists; likely a dev-launcher/harness artefact.

## Environment

- **Backend:** jar built from `1d07dfb` (`./mvnw -DskipTests package`), `SPRING_PROFILES_ACTIVE=dev`, `DB_URL=jdbc:postgresql://localhost:5433/labby` (container `labby-postgres`), `RIDE_SIM_ENABLED=false`, default job timings. Real SMS through the owner's Traccar gateway (backend/.env). Real FCM from `~/.config/labby/`.
- **Mobile:** emulator "labby" (`-memory 3072`, 1080×2400), rider and driver dev clients on Metro 8083/8081, `adb reverse` 8080/8081/8083. GPS through `adb emu geo fix` in a loop.
- **Admin:** Vite dev server :5173 in the Claude browser pane at 1440 px. Screenshots were taken from the pane instead of geckodriver/Firefox, to save time.
- **Harness:** a Python script (requests) playing the counterpart driver or rider over the same REST endpoints; every call was logged.
- **Real SMS numbers (masked):**
  - rider 0991••••88: 5 codes (register, 3× 2FA, re-register);
  - driver 0935••••31: 2 register codes (both unused/expired), then 2 admin set-password codes (the original and a resend; the resend was used);
  - driver 0936••••44: 1 register code.

  No SMS went to any other number. No rate-limit or lockout scenario was run. Some screenshots show these numbers unmasked (OTP and settings screens).
- **Push safety:** before enabling FCM, `device_tokens` held one pre-existing token, which was deleted. During the run, the only token ever registered was the emulator's rider-app token (re-checked after each new login).

## Data changed in the local DB

All changes were on the local container only. The ~3,050 "Load …" accounts were not touched.

1. `device_tokens` row `1f8adbfc…` (pre-existing, +96390000000**1** rider) deleted before enabling FCM.
2. Created rider **Rider A** (0991••••88) via the rider app. It was later deleted (2FA) and reactivated by re-registering.
3. `rides b4f28ec6…`: `cancellation_grace_ends_at` set to now−1 min (late-cancel fee scenario).
4. Created **Driver B** (0936••••44) via the driver app. Because of L-C1, the profile photo, 4 documents and 2 vehicle photos were uploaded and the application submitted through the API harness; it was approved in admin (Economy).
5. `scheduled_rides 6a992c89…`: `scheduled_at` set to now+14 min (trigger the T−15 conversion).
6. Created admin **Support Tester** (0935••••31, Support role) in admin; its password was set through the SMS flow.
7. Side effects of the clicked flows: promo **FREE100** (100 %, Damascus, to 2026-10-31); a 50,000 SYP wallet grant to Rider A; a 3,750 SYP settlement pay-in for Driver B; a support ticket, a report (unsubstantiated), an SOS event (acknowledged); ratings; rides of every kind; driver availability (Wednesday all day). Seeded drivers +96390000000**7** and **5** used by the harness.

## What was not tested and why

- **1,696 of the 1,750 matrix rows** were not run. The owner limited the run to main flows in a 4–5-hour window. Not run: every alternate/exception beyond the ones listed, all boundary and timer rows except 30-min scheduling, the 100 m geofence, the 15 s offer window, the 2/5-min graces and the T−15 conversion. Also not run: races and double taps, resilience (OSRM down, backend restart, network off, cold start mid-ride, stream lost), the full EN+AR sweep of every screen against its board, input validation, and incentives, loyalty, referrals, challenges, badges, lost items, help-centre CMS, analytics filters, exports, regions/surge editing and custom RBAC roles. The matrix is in [`live-test-2026-10-21/matrix/`](live-test-2026-10-21/matrix/), ready for the next session.
- **OTP rate-limit and lockout scenarios** (5 wrong codes, 5 codes/hour): deliberately not run, to keep the owner's numbers usable.
- **Driver-app in-app application, document upload and renewal:** blocked by L-C1; the application was submitted through the harness instead.
- **Push on the driver app** (offers, cold-start/background tap routing): not possible, because the driver dev client has no Firebase config. Rider push delivery was verified in the foreground and background notification shade; push-tap routing was not exercised.
- **A second emulator** was not used; one emulator plus the harness covered both roles.
- **Custom partial RBAC roles:** only the seeded Support role was tested.
