# Labby design system

Owner-approved 2026-10-07. Visual reference: the Labby design canvas
https://claude.ai/artifact/EcFBr8QR8GLWSS6MF1VceY (rider: Home / Choose a ride / Driver on the way;
driver: Offline + GO / Ride offer / Documents; admin: Driver applications / Review an application /
Document expiry). Every new screen gets an artboard there and owner approval **before** code
(CLAUDE.md "Design first").

## Principles
- Uber-style layout patterns. Mobile: map-first, bottom sheets, one dominant action per screen.
  Admin: clean tables/queues with a single primary action per view.
- White / light-grey surfaces, near-black text, **Labby purple `#59128A` as the only accent**.
  No gradients, no other purples in new code. Status colours appear only in chips and banners.
- Bold type, touch targets ≥ 48 px (mobile), full EN + AR with correct RTL, safe-area insets on
  every mobile screen.
- Never copy another company's brand assets.

## Tokens
Source of truth: `assets/theme/colors.scss` (section "Design system 2026-10-07"), mirrored in
`apps/rider/src/theme/tokens.ts`, `apps/driver/src/theme/tokens.ts`, `apps/admin/src/theme/tokens.css`.

| Token | Value | Use |
|---|---|---|
| accent | `#59128A` | primary buttons, selected state, links, GO button |
| accent-pressed | `#3D0B57` | pressed / hover of accent |
| accent-tint | `#F1EAF8` | active nav pill, accent chip ground, avatar ground |
| text | `#141018` | primary text, icons, selected outlines |
| text-secondary | `#463C58` | secondary lines |
| text-muted | `#6E6780` | captions, table headers, hints |
| surface | `#FFFFFF` | sheets, cards, screens |
| surface-page | `#F7F6F9` | admin page ground |
| surface-fill | `#F2F0F5` | inputs, icon wells, secondary buttons |
| surface-map | `#ECE9F0` | map ground / placeholder |
| line | `#EEEBF2` | row dividers |
| line-strong | `#DCD8E2` | outlined buttons, unselected chip outline |
| grab-handle | `#D9D5DF` | bottom-sheet handle |
| success / -bg | `#067647` / `#ECFDF3` | "Valid", "Approved" chips |
| warning / -bg | `#93370D` / `#FFF6E5` | "Renew soon", "Under review" chips, warning banners |
| danger / -bg | `#B42318` / `#FEF3F2` | errors, destructive text buttons, "Rejected" |
| online | `#12B76A` | the online status dot only |

Spacing 4 / 8 / 12 / 16 / 20 / 24 / 32. Radii: 8 small chip, 10 admin buttons/nav pill,
14 mobile buttons/inputs, 16 cards/offer card/tables, 24 bottom-sheet top corners, 999 round.
Shadows: floating buttons `0 2 10 rgba(20,16,24,.16)`, sheets `0 -6 24 rgba(20,16,24,.12)`.

## Typography
- **Manrope** (Latin) and **IBM Plex Sans Arabic** (Arabic), chosen by the active locale
  (AR → Plex Arabic for all text; EN → Manrope). Weights used: 400, 600, 700, 800 (Plex Arabic
  tops out at 700; 800 maps to 700).
- Mobile: `@expo-google-fonts/manrope` + `@expo-google-fonts/ibm-plex-sans-arabic`, loaded at the
  root layout before first render. Android ignores `fontWeight` on custom fonts, so text goes through
  an app-level text primitive that maps weight → the per-weight family name.
- Admin: `@fontsource/manrope` + `@fontsource/ibm-plex-sans-arabic` (self-hosted, no CDN), font
  family switched by `html[lang="ar"]`.
- Scale (mobile): display 32/800 (screen titles), title 26/800 ("Where to?"), heading 20–22/800,
  body 16–17/700 (row titles) and 14–15/400 (secondary), caption 12–13/600. Admin: h1 30/800,
  h2 18/800, body 15, table header 13/700 muted.
- Plates and Arabic names inside EN layouts render in Plex Arabic with `dir="rtl"`.

## Mobile components (rider + driver, each app owns its copy)
- **MapScreen**: full-bleed map (ground `surface-map`) with floating content laid over it, honouring
  safe-area insets.
- **MapFab**: 48 px round white button, floating shadow, 20 px stroke icon, `accessibilityLabel`
  required; optional accent badge dot.
- **BottomSheet**: white, 24 px top radius, sheet shadow, 40×5 grab handle, padding 20, bottom
  padding = 34 or the safe-area inset, whichever is larger.
- **PrimaryButton**: full width, 56 px, radius 14, accent fill, 18/800 white label; disabled at
  40 % opacity; loading shows a spinner. **SecondaryButton**: surface-fill ground, text colour.
  **DestructiveTextButton**: danger text, no fill.
- **ListRow**: min 64 px (76 with two lines + chip), optional 40 px round icon well
  (`surface-fill`), title 16–17/700, subtitle 14 muted, optional trailing chip and chevron,
  `line` divider except on the last row. Chevrons flip in RTL.
- **StatusChip**: 13/700, padding 4×10, radius 12, tone = accent | success | warning | danger |
  neutral.
- **Banner**: radius 14, tone ground (`warning-bg` etc.), icon + 14 px text.
- **TextField**: 56 px, `surface-fill` ground, radius 14, no border at rest, 2 px `text` outline on
  focus, danger outline + message on error; password eye toggle stays.
- **ScreenHeader** (non-map screens): back chevron 44 px (flips in RTL), then a 32/800 title,
  left-aligned (right in RTL).
- **GoButton** (driver): 96 px round accent button with a 5 px white ring, label "GO", above the
  status sheet.

## Admin components
- **Sidebar**: 248 px white, right border `line`; brand mark (32 px accent square "L" + "Labby Admin");
  nav links 44 px, radius 10, 15/600 `text-secondary`; active = `accent-tint` ground, accent 800 text,
  optional count badge; divider between ops and RBAC groups. Mirrors in RTL.
- **TopBar**: 68 px white, bottom border; search field (42 px, `surface-fill`, radius 12) — visual
  only until a search endpoint exists; notification bell 42 px round `surface-fill`; avatar + name.
- **PageHeader**: h1 30/800 + muted 15 px description; primary action right-aligned (left in RTL).
- **FilterChips**: 38 px pills; selected = `text` fill white label; unselected = white with
  `line-strong` outline. Optional "· count".
- **DataTable**: white card, radius 16, `line` border; header 13/700 muted; rows 16 px vertical
  padding with `#F0EEF3` separators; row primary action as an accent button only on the first
  actionable row, outlined buttons otherwise; footer with "Showing x–y of n" and prev/next.
- **DecisionPanel**: right-hand aside (320–380 px) holding the page's decision controls, primary
  action first, then secondary outline, then destructive text button, then history.
- **KpiTile**: white card, radius 16, 13/700 muted label, 30/800 value.
- Buttons: primary 40–52 px accent radius 10–12; outline `line-strong`; destructive text danger.
- Forms: 44 px inputs, radius 10, `line-strong` border, accent focus ring.
