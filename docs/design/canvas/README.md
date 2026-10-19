# Labby design canvas — offline copy

Every artboard of the owner-approved Labby design canvas. The live canvas is the owner's Design
canvas https://claude.ai/artifact/2pihbKeV5dgzEJYaomYDZU (recreated 2026-10-18 under the owner's
current account from this snapshot; the original account's canvas is gone). Claude Code cannot
publish into a Design canvas, so the approval loop for NEW screens is:

1. Draw the board here as a `.dc.html` file (mobile 390×844, admin 1440 wide), register it in
   `canvas.json` and in the list below.
2. Regenerate the gallery (`python3 docs/design/canvas/build-index.py docs/design/canvas
   "<new boards, comma-separated>"`) and republish it to the review gallery artifact
   https://claude.ai/artifact/EcFBr8QR8GLWSS6MF1VceY (page `index.html`, every `*.dc.html` as a
   supporting file at the same relative path) — new boards show there as "Awaiting approval".
3. The owner approves on the gallery (or on the rendered files sent in chat), then adds the
   approved boards to the Design canvas by hand; only then is the screen implemented.

- `canvas.json` — this snapshot's index: pages, artboard frames, titles and section notes (the
  live canvas keeps its own index with its own page ids and frame positions).
- `*.dc.html` — one file per artboard. Each file is plain HTML with inline styles and opens
  directly in a browser; the `./support.js` line is the canvas editor's runtime and is not needed
  to view the layout.
- `build-index.py` + `index.html` — the gallery page above (every board rendered live at scale,
  boards awaiting approval flagged).

Tokens and rules live in [../design-system.md](../design-system.md); this folder is the visual reference.

## UI redesign

- [Rider · Home](Main.dc.html)
- [Rider · Choose a ride](RiderChooseRide.dc.html)
- [Rider · Driver on the way](RiderDriverOnWay.dc.html)
- [Driver · Offline](DriverOffline.dc.html)
- [Driver · Ride offer](DriverOffer.dc.html)
- [Driver · Documents](DriverDocuments.dc.html)
- [Admin · Driver applications](AdminApplications.dc.html)
- [Admin · Review an application](AdminApplicationReview.dc.html)
- [Admin · Document expiry](AdminDocumentExpiry.dc.html)

## M7 · Ride loop

- [Rider · Where to?](RiderWhereTo.dc.html)
- [Rider · Where to? (AR, RTL)](RiderWhereToAr.dc.html)
- [Rider · Finding your driver](RiderFinding.dc.html)
- [Rider · No driver found](RiderNoDriver.dc.html)
- [Rider · Driver arrived](RiderArrived.dc.html)
- [Rider · On the ride](RiderInRide.dc.html)
- [Rider · Cancel ride](RiderCancel.dc.html)
- [Rider · Ride complete](RiderComplete.dc.html)
- [Rider · Your rides](RiderHistory.dc.html)
- [Rider · Receipt](RiderReceipt.dc.html)
- [Rider · Saved places](RiderSavedPlaces.dc.html)
- [Rider · Ride preferences](RiderPreferences.dc.html)
- [Driver · To pickup](DriverToPickup.dc.html)
- [Driver · At pickup](DriverAtPickup.dc.html)
- [Driver · On the ride](DriverInRide.dc.html)
- [Driver · Collect cash](DriverComplete.dc.html)
- [Driver · Cancel ride](DriverCancel.dc.html)
- [Rider · Driver on the way · Cancel (addition)](RiderOnWayCancel.dc.html)
- [Rider · Plan your ride · comfort summary (addition)](RiderPlanComfort.dc.html)
- [Rider · Ride ended · you cancelled (addition)](RiderRideEndedCancel.dc.html)
- [Rider · Ride ended · no-show (addition)](RiderRideEndedNoShow.dc.html)
- [Rider · Settings · Rides (addition)](RiderSettingsRides.dc.html)
- [Driver · Connection lost on ride (addition)](DriverStreamLost.dc.html)
- [Driver · Offer · surge note (addition)](DriverOfferSurge.dc.html)
- [Driver · Notice · cash received (addition)](DriverNoticeCash.dc.html)
- [Driver · Notice · unpaid (addition)](DriverNoticeUnpaid.dc.html)
- [Driver · Notice · rider cancelled (addition)](DriverNoticeRiderCancel.dc.html)
- [Driver · Cancel · no-show wording (addition)](DriverNoShowCancel.dc.html)

## M8 · Money

- [Rider · Wallet](RiderWallet.dc.html)
- [Rider · Wallet (AR, RTL)](RiderWalletAr.dc.html)
- [Rider · Tip your driver](RiderTip.dc.html)
- [Rider · Choose a ride · wallet short](RiderWalletShort.dc.html)
- [Rider · Waiting charge notice](RiderWaitCharge.dc.html)
- [Rider · Receipt · wallet + cash + due](RiderReceiptSplit.dc.html)
- [Rider · Cancel · fee carried](RiderCancelFee.dc.html)
- [Driver · Trip earnings](DriverTripEarnings.dc.html)
- [Driver · Earnings & commission](DriverEarnings.dc.html)
- [Driver · Balance · warning](DriverBalance.dc.html)
- [Driver · Blocked · settle to resume](DriverBlocked.dc.html)
- [Admin · User wallet & credits](AdminUserWallet.dc.html)
- [Admin · Driver ledger & settlement](AdminDriverLedger.dc.html)

## M9 · Surge

- [Rider · Choose a ride · surge](RiderSurgeChoose.dc.html)
- [Rider · Choose a ride · surge (AR, RTL)](RiderSurgeChooseAr.dc.html)
- [Rider · Price changed · confirm again](RiderSurgeChanged.dc.html)
- [Driver · Demand heatmap](DriverHeatmap.dc.html)
- [Admin · Surge zones & override](AdminSurgeZones.dc.html)

## M10 · Comms & safety

- [Rider · Chat with driver](RiderChat.dc.html)
- [Rider · Chat (AR, RTL)](RiderChatAr.dc.html)
- [Rider · On the ride · chat, call, share, SOS](RiderSafetyActions.dc.html)
- [Rider · SOS · confirm](RiderSosConfirm.dc.html)
- [Public · Shared trip page (no login)](SharePage.dc.html)
- [Driver · Chat · one-tap quick replies](DriverChat.dc.html)
- [Driver · On the ride · chat, call, share, SOS](DriverSafetyActions.dc.html)
- [Admin · Live ops map & SOS alerts](AdminLiveOps.dc.html)
- [Admin · Rides search](AdminRides.dc.html)
- [Admin · Ride detail · timeline, trace, chat](AdminRideDetail.dc.html)

## M11 · Trust

- [Rider · Rate your driver](RiderRate.dc.html)
- [Rider · Rate (AR, RTL)](RiderRateAr.dc.html)
- [Rider · Your rides · rate later](RiderHistoryRate.dc.html)
- [Rider · Report your driver](RiderReport.dc.html)
- [Rider · Report sent · your reports](RiderReports.dc.html)
- [Rider · Account suspended](RiderSuspended.dc.html)
- [Driver · Rate your rider](DriverRateRider.dc.html)
- [Driver · Report your rider](DriverReportRider.dc.html)
- [Driver · Performance · metric warning](DriverPerformance.dc.html)
- [Driver · Performance (AR, RTL)](DriverPerformanceAr.dc.html)
- [Driver · Performance · rating near limit](DriverRatingWarning.dc.html)
- [Driver · Suspended · low rating](DriverSuspended.dc.html)
- [Admin · Reports queue](AdminReports.dc.html)
- [Admin · Report · evidence & resolve](AdminReportDetail.dc.html)
- [Admin · Flagged accounts](AdminFlags.dc.html)
- [Admin · User · ratings, reports, flags, suspend](AdminUserTrust.dc.html)

## M12 driver

- [Home · scheduled entry](D12Home.dc.html)
- [Availability (UC-D-05)](D12Availability.dc.html)
- [Availability · AR](D12AvailabilityAr.dc.html)
- [Add a window](D12AvailabilityAdd.dc.html)
- [Claim board (UC-D-11)](D12ClaimBoard.dc.html)
- [Claim board · AR](D12ClaimBoardAr.dc.html)
- [Already claimed (E1)](D12ClaimRace.dc.html)
- [Board · no availability](D12ClaimBoardEmpty.dc.html)
- [My claimed rides + reminders](D12MyRides.dc.html)
- [Release a claim (UC-D-12 E1)](D12Release.dc.html)
- [Live at T−15 (UC-D-12)](D12Converted.dc.html)
- [System release / rider busy](D12Notices.dc.html)
- [Shared offer (UC-D-13)](D12SharedOffer.dc.html)
- [Members at pickup](D12SharedPickup.dc.html)
- [Members at pickup · AR (after grace)](D12SharedPickupAr.dc.html)
- [Mark absent (E1)](D12NoShowConfirm.dc.html)
- [Per-member chats](D12SharedChats.dc.html)
- [Per-member collection](D12SharedCollect.dc.html)
- [Per-member collection · AR](D12SharedCollectAr.dc.html)

## M12 rider

- [Rider · Home · Later + scheduled + shared entries](RiderM12Home.dc.html)
- [Rider · Schedule · pickup time (UC-R-10)](RiderSchedWhen.dc.html)
- [Rider · Schedule · priced at ride time](RiderSchedChoose.dc.html)
- [Rider · Schedule · too soon (E1, book now instead)](RiderSchedTooSoon.dc.html)
- [Rider · Scheduled rides · claim status (UC-R-11)](RiderSchedUpcoming.dc.html)
- [Rider · Scheduled rides (AR, RTL)](RiderSchedUpcomingAr.dc.html)
- [Rider · Scheduled ride · detail](RiderSchedDetail.dc.html)
- [Rider · Scheduled ride · cancel free](RiderSchedCancel.dc.html)
- [Rider · Book now · scheduled ride within 60 min](RiderSchedWarn.dc.html)
- [Rider · Shared rides · browse (UC-R-13)](RiderSharedBrowse.dc.html)
- [Rider · Shared rides · browse (AR, RTL)](RiderSharedBrowseAr.dc.html)
- [Rider · Shared ride · join](RiderSharedJoin.dc.html)
- [Rider · Shared ride · join blocked (E1, E2)](RiderSharedJoinErrors.dc.html)
- [Rider · Share a ride · create (UC-R-12)](RiderSharedCreate.dc.html)
- [Rider · Shared ride · creator: start / cancel (UC-R-15)](RiderSharedGathering.dc.html)
- [Rider · Shared ride · member view, leave free (UC-R-14)](RiderSharedMember.dc.html)
- [Rider · Shared ride · driver on the way](RiderSharedOnWay.dc.html)
- [Rider · Shared ride · leave after dispatch (fee quote)](RiderSharedLeave.dc.html)
- [Rider · Shared ride · private chat with driver](RiderSharedChat.dc.html)
- [Rider · Shared ride · per-seat receipt (RIDE-P4)](RiderSharedReceipt.dc.html)

## M12 driver

- [Report a rider · pick the member (shared)](D12ReportWho.dc.html)
- [Report a rider · pick the member · AR](D12ReportWhoAr.dc.html)

## M12 admin

- [Admin · Ride detail · shared ride chat log per member](A12ChatLogMembers.dc.html)

## M12 rider

- [Rider · Home · open shared ride card (W10)](RiderSharedHomeCard.dc.html)

## M13 · Growth

- [Rider · Choose a ride · promo applied (UC-R-18)](R13PromoChoose.dc.html)
- [Rider · Promo code · validation messages](R13PromoErrors.dc.html)
- [Rider · Invite friends (GRW-03)](R13Referral.dc.html)
- [Rider · Invite friends (AR, RTL)](R13ReferralAr.dc.html)
- [Rider · Labby Points (GRW-04)](R13Loyalty.dc.html)
- [Rider · Redeem points · sheet](R13Redeem.dc.html)
- [Rider · Level & badges (GAME-01)](R13Profile.dc.html)
- [Rider · Challenges (GAME-02)](R13Challenges.dc.html)
- [Driver · Level & badges](D13Badges.dc.html)
- [Driver · Challenges](D13Challenges.dc.html)
- [Driver · Challenges (AR, RTL)](D13ChallengesAr.dc.html)
- [Admin · Promotions · list & deactivate (UC-A-26)](A13Promos.dc.html)
- [Admin · New promo](A13PromoCreate.dc.html)
- [Admin · Challenges · list & create (UC-A-28)](A13Challenges.dc.html)
- [Admin · Challenge · participation & early end](A13ChallengeDetail.dc.html)
- [Rider · Create account · referral code (GRW-03, M13-T5)](R13RegisterReferral.dc.html)
- [Rider · Create account · referral code (AR, RTL)](R13RegisterReferralAr.dc.html)

## M14 · Support & content

- [Rider+Driver · Support home · help first (UC-S-19/21)](S14Support.dc.html)
- [Rider+Driver · Help category · articles](S14HelpCategory.dc.html)
- [Rider+Driver · Help article (UC-S-21 A1)](S14HelpArticle.dc.html)
- [Rider+Driver · Help search](S14HelpSearch.dc.html)
- [Rider+Driver · Create a ticket (SUP-01)](S14TicketCreate.dc.html)
- [Rider+Driver · Your tickets (UC-S-20)](S14Tickets.dc.html)
- [Rider+Driver · Ticket thread · waiting on you (SUP-02)](S14TicketThread.dc.html)
- [Rider+Driver · Ticket thread (AR, RTL)](S14TicketThreadAr.dc.html)
- [Rider+Driver · Share feedback (FDBK-01)](S14Feedback.dc.html)
- [Rider · Report a lost item (UC-R-20)](R14LostReport.dc.html)
- [Rider · Lost-item case · reopened chat (LOST-02)](R14LostCase.dc.html)
- [Driver · Lost-item case · reopened chat (UC-D-21)](D14LostCase.dc.html)
- [Admin · Support tickets · queue (UC-A-21)](A14TicketQueue.dc.html)
- [Admin · Ticket · thread, states, remedy (SUP-02/03)](A14TicketDetail.dc.html)
- [Admin · Lost-item cases · queue (UC-A-22)](A14LostQueue.dc.html)
- [Admin · Lost-item case · progression (LOST-02)](A14LostCase.dc.html)
- [Admin · Help center CMS (UC-A-23)](A14HelpCms.dc.html)
- [Admin · Article editor · EN/AR, publish gate (NFR-I1)](A14HelpEditor.dc.html)
- [Admin · Ticket categories (UC-A-24)](A14TicketCategories.dc.html)
- [Admin · Feedback · tags & trends (UC-A-25)](A14Feedback.dc.html)
