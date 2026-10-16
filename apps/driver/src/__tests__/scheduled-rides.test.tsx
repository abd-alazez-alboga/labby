/**
 * M12-T4 — UC-D-05, UC-D-11, UC-D-12 against scheduled-shared-v1.yaml mocks:
 * the weekly availability windows (Monday first, add / remove / past
 * midnight / all day / duplicate, PUT of the whole set, 400), the home
 * entry, the claim board (claim, the lost race 409 → refresh, 422
 * not_eligible, no windows), the claimed rides with Release (reason sheet,
 * `other` needs a note, 409 once live), the T−15 conversion landing as the
 * live ride, the scheduled pushes, and Arabic RTL with Western digits.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import i18n, { initI18n, setAppLanguage } from "../i18n";
import { scheduledNoticeFor } from "../notifications/deep-links";
import { formatRelative } from "../scheduled/format";
import { isDuplicate, sortWindows, spansMidnight } from "../scheduled/windows";
import { MockSocket } from "../test-utils/realtime";
import {
  ACTIVE_RIDE,
  CLAIM_BOARD_SUMMARY,
  CLAIMED_RIDES,
  goLive,
  mockLocationGranted,
  renderDriverApp,
  screen,
  waitForResync,
} from "../test-utils/ride-harness";
import { rideFixture } from "../test-utils/rides";
import {
  BOARD,
  boardEntry,
  boardPage,
  CLAIMS,
  claimedRide,
  claimRoute,
  coded,
  inHours,
  ok,
  releaseRoute,
  SCHEDULED_ID,
  SCHEDULED_ID_2,
  WINDOWS_GET,
  WINDOWS_PUT,
} from "../test-utils/scheduled";

const originalWebSocket = globalThis.WebSocket;

const WINDOWS = {
  windows: [
    { dayOfWeek: 1, startsAt: "07:00", endsAt: "12:00" },
    { dayOfWeek: 1, startsAt: "17:00", endsAt: "22:00" },
    { dayOfWeek: 5, startsAt: "22:00", endsAt: "02:00" },
    { dayOfWeek: 6, startsAt: "00:00", endsAt: "00:00" },
  ],
};

function at(time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

describe("scheduled rides (UC-D-05, UC-D-11, UC-D-12)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    MockSocket.reset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
    mockLocationGranted();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  // ------------------------------------------------------------ helpers

  it("orders windows Monday first, detects past-midnight and duplicate windows", () => {
    const sorted = sortWindows([
      { dayOfWeek: 7, startsAt: "08:00", endsAt: "10:00" },
      { dayOfWeek: 1, startsAt: "17:00", endsAt: "22:00" },
      { dayOfWeek: 1, startsAt: "07:00", endsAt: "12:00" },
    ]);
    expect(sorted.map((w) => `${w.dayOfWeek} ${w.startsAt}`)).toEqual([
      "1 07:00",
      "1 17:00",
      "7 08:00",
    ]);
    expect(spansMidnight({ dayOfWeek: 5, startsAt: "22:00", endsAt: "02:00" })).toBe(true);
    expect(spansMidnight({ dayOfWeek: 5, startsAt: "08:00", endsAt: "12:00" })).toBe(false);
    expect(isDuplicate(sorted, { dayOfWeek: 1, startsAt: "07:00", endsAt: "12:00" })).toBe(true);
    expect(isDuplicate(sorted, { dayOfWeek: 2, startsAt: "07:00", endsAt: "12:00" })).toBe(false);
  });

  it("formats the time left before pickup and maps the scheduled pushes", () => {
    const now = Date.parse("2026-10-16T08:00:00Z");
    const t = i18n.t.bind(i18n);
    expect(formatRelative(t, "2026-10-16T08:40:00Z", "en", now)).toBe("in 40 min");
    expect(formatRelative(t, "2026-10-16T22:00:00Z", "en", now)).toBe("in 14 h");
    expect(formatRelative(t, "2026-10-19T08:00:00Z", "en", now)).toBe("in 3 days");
    expect(scheduledNoticeFor("scheduled.cancelled_rider_busy")).toBe("scheduledRiderBusy");
    expect(scheduledNoticeFor("scheduled.released")).toBe("scheduledReleased");
    expect(scheduledNoticeFor("scheduled.reminder")).toBeNull();
  });

  // ---------------------------------------------------------- home entry

  it("home shows the next claim and the open count, and opens the board", async () => {
    await renderDriverApp({
      [CLAIMED_RIDES]: ok([claimedRide({ scheduled: { scheduledAt: inHours(14), claimState: "claimed", pricedAtRideTime: true } })]),
      [CLAIM_BOARD_SUMMARY]: ok({ items: [], page: 0, size: 1, totalItems: 5 }),
      [BOARD]: ok(boardPage([boardEntry()])),
      [WINDOWS_GET]: ok(WINDOWS),
    });
    await waitFor(() =>
      expect(screen.getByTestId("scheduled-entry-subtitle")).toHaveTextContent(
        /Next: .+ · Mazzeh Autostrad, gate 3 · 5 open on the board/,
      ),
    );
    fireEvent.press(screen.getByTestId("scheduled-entry"));
    expect(await screen.findByTestId("scheduled-rides-screen")).toBeTruthy();
    expect(await screen.findByTestId(`board-${SCHEDULED_ID}`)).toBeTruthy();
  });

  // --------------------------------------------------------------- board

  it("lists open rides with the pickup area, estimate priced at ride time; Claim locks one", async () => {
    const contract = await renderDriverApp(
      {
        [BOARD]: [ok(boardPage([boardEntry()])), ok(boardPage([]))],
        [WINDOWS_GET]: ok(WINDOWS),
        [CLAIMS]: [ok([]), ok([claimedRide()])],
        [claimRoute(SCHEDULED_ID)]: ok(claimedRide()),
      },
      { initialUrl: "/scheduled-rides" },
    );
    const card = await screen.findByTestId(`board-${SCHEDULED_ID}`);
    expect(card).toHaveTextContent(/Pickup area ≈/);
    expect(card).toHaveTextContent(/Mazzeh Autostrad/);
    expect(card).toHaveTextContent(/Umayyad Square/);
    expect(screen.getByTestId(`board-${SCHEDULED_ID}-fare`)).toHaveTextContent("SYP 22,000");
    expect(card).toHaveTextContent(/Priced at ride time · Cash/);
    expect(screen.getByTestId("board-count")).toHaveTextContent(/1 rides/);

    fireEvent.press(screen.getByTestId(`board-${SCHEDULED_ID}-claim`));
    expect(await screen.findByTestId("scheduled-notice-claimed")).toHaveTextContent(
      /Claimed · .+The rider is told/,
    );
    expect(contract.requestsTo(claimRoute(SCHEDULED_ID))).toHaveLength(1);
    expect(contract.requestsTo(claimRoute(SCHEDULED_ID))[0].body).toBeNull();
    // The board and the claims are re-read.
    await waitFor(() => expect(screen.queryByTestId(`board-${SCHEDULED_ID}`)).toBeNull());
    expect(await screen.findByText("My rides · 1")).toBeTruthy();
  });

  it("a lost claim race (409 already_claimed) says so and refreshes the board (E1)", async () => {
    const contract = await renderDriverApp(
      {
        [BOARD]: [
          ok(boardPage([boardEntry(), boardEntry({ rideId: SCHEDULED_ID_2 })])),
          ok(boardPage([boardEntry({ rideId: SCHEDULED_ID_2 })])),
        ],
        [WINDOWS_GET]: ok(WINDOWS),
        [CLAIMS]: ok([]),
        [claimRoute(SCHEDULED_ID)]: coded(409, "already_claimed"),
      },
      { initialUrl: "/scheduled-rides" },
    );
    fireEvent.press(await screen.findByTestId(`board-${SCHEDULED_ID}-claim`));
    expect(await screen.findByTestId("scheduled-notice-alreadyClaimed")).toHaveTextContent(
      /Another driver claimed it first/,
    );
    await waitFor(() => expect(screen.queryByTestId(`board-${SCHEDULED_ID}`)).toBeNull());
    expect(screen.getByTestId(`board-${SCHEDULED_ID_2}`)).toBeTruthy();
    expect(contract.requestsTo(BOARD).length).toBe(2);
  });

  it("a 422 not_eligible names the rule; a closed claim says the ride is gone", async () => {
    await renderDriverApp(
      {
        [BOARD]: ok(boardPage([boardEntry(), boardEntry({ rideId: SCHEDULED_ID_2 })])),
        [WINDOWS_GET]: ok(WINDOWS),
        [CLAIMS]: ok([]),
        [claimRoute(SCHEDULED_ID)]: coded(422, "not_eligible", { rule: "window" }),
        [claimRoute(SCHEDULED_ID_2)]: coded(409, "claim_closed"),
      },
      { initialUrl: "/scheduled-rides" },
    );
    fireEvent.press(await screen.findByTestId(`board-${SCHEDULED_ID}-claim`));
    expect(await screen.findByTestId("scheduled-notice-notEligible")).toHaveTextContent(
      /outside your availability times/,
    );
    fireEvent.press(await screen.findByTestId(`board-${SCHEDULED_ID_2}-claim`));
    expect(await screen.findByTestId("scheduled-notice-claimClosed")).toHaveTextContent(
      /no longer open/,
    );
  });

  it("without availability windows the board asks for them first", async () => {
    await renderDriverApp(
      {
        [BOARD]: ok(boardPage([])),
        [WINDOWS_GET]: ok({ windows: [] }),
        [CLAIMS]: ok([]),
      },
      { initialUrl: "/scheduled-rides" },
    );
    expect(await screen.findByTestId("board-no-windows")).toHaveTextContent(
      /Set your availability first/,
    );
    fireEvent.press(screen.getByTestId("board-set-availability"));
    expect(await screen.findByTestId("availability-screen")).toBeTruthy();
  });

  it("with windows but nothing matching, the board says so", async () => {
    await renderDriverApp(
      { [BOARD]: ok(boardPage([])), [WINDOWS_GET]: ok(WINDOWS), [CLAIMS]: ok([]) },
      { initialUrl: "/scheduled-rides" },
    );
    expect(await screen.findByTestId("board-empty")).toHaveTextContent(
      /No open rides match your availability/,
    );
  });

  // ------------------------------------------------------------- my rides

  it("My rides shows the exact pickup and rider; Release needs a reason (other + note)", async () => {
    const contract = await renderDriverApp(
      {
        [BOARD]: ok(boardPage([])),
        [WINDOWS_GET]: ok(WINDOWS),
        [CLAIMS]: [ok([claimedRide()]), ok([])],
        [releaseRoute(SCHEDULED_ID)]: { status: 204 },
      },
      { initialUrl: "/scheduled-rides?tab=mine" },
    );
    const card = await screen.findByTestId(`claimed-${SCHEDULED_ID}`);
    expect(card).toHaveTextContent(/Rana/);
    expect(card).toHaveTextContent(/Mazzeh Autostrad, gate 3/);
    expect(card).toHaveTextContent(/We'll remind you before pickup/);

    fireEvent.press(screen.getByTestId(`claimed-${SCHEDULED_ID}-release`));
    expect(await screen.findByTestId("release-title")).toHaveTextContent("Release Rana's ride?");
    expect(screen.getByTestId("release-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("release-reason-other"));
    fireEvent.press(screen.getByTestId("release-confirm"));
    expect(await screen.findByText("Tell us briefly what happened.")).toBeTruthy();
    expect(contract.requestsTo(releaseRoute(SCHEDULED_ID))).toHaveLength(0);

    fireEvent.changeText(screen.getByTestId("release-note"), "Family emergency");
    fireEvent.press(screen.getByTestId("release-confirm"));
    expect(await screen.findByTestId("scheduled-notice-released")).toBeTruthy();
    expect(contract.requestsTo(releaseRoute(SCHEDULED_ID))[0].body).toEqual({
      reason: "other",
      note: "Family emergency",
    });
    expect(await screen.findByTestId("mine-empty")).toBeTruthy();
    expect(screen.queryByTestId("release-sheet")).toBeNull();
  });

  it("a claim within the last hour reads 'Goes live soon'; a release after conversion (409) points to the live ride", async () => {
    const soon = claimedRide({
      scheduled: { scheduledAt: inHours(0.6), claimState: "claimed", pricedAtRideTime: true },
    });
    await renderDriverApp(
      {
        [BOARD]: ok(boardPage([])),
        [WINDOWS_GET]: ok(WINDOWS),
        [CLAIMS]: [ok([soon]), ok([])],
        [releaseRoute(SCHEDULED_ID)]: coded(409, "illegal_state", { state: "accepted" }),
      },
      { initialUrl: "/scheduled-rides?tab=mine" },
    );
    expect(await screen.findByTestId(`claimed-${SCHEDULED_ID}-soon`)).toHaveTextContent(
      "Goes live soon",
    );
    fireEvent.press(screen.getByTestId(`claimed-${SCHEDULED_ID}-release`));
    fireEvent.press(await screen.findByTestId("release-reason-vehicle_issue"));
    fireEvent.press(screen.getByTestId("release-confirm"));
    expect(await screen.findByTestId("scheduled-notice-alreadyLive")).toHaveTextContent(
      /already live/,
    );
  });

  // --------------------------------------------------------- availability

  it("availability lists the week Monday first; remove + add (past midnight) and Save the whole set", async () => {
    const saved = {
      windows: [
        { dayOfWeek: 1, startsAt: "07:00", endsAt: "12:00" },
        { dayOfWeek: 2, startsAt: "22:00", endsAt: "02:00" },
        { dayOfWeek: 5, startsAt: "22:00", endsAt: "02:00" },
        { dayOfWeek: 6, startsAt: "00:00", endsAt: "00:00" },
      ],
    };
    const contract = await renderDriverApp(
      { [WINDOWS_GET]: ok(WINDOWS), [WINDOWS_PUT]: ok(saved) },
      { initialUrl: "/availability-windows" },
    );
    expect(await screen.findByTestId("day-row-1")).toHaveTextContent(/^Monday/);
    expect(screen.getByTestId("day-row-7")).toHaveTextContent(/Sunday.*Not available/);
    expect(screen.getByTestId("window-chip-5-22:00-02:00")).toHaveTextContent(
      "22:00–02:00 · next day",
      { exact: false },
    );
    expect(screen.getByTestId("window-chip-6-00:00-00:00")).toHaveTextContent("All day", { exact: false });
    expect(screen.getByTestId("availability-save").props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByTestId("window-remove-1-17:00-22:00"));
    expect(screen.queryByTestId("window-chip-1-17:00-22:00")).toBeNull();

    fireEvent.press(screen.getByTestId("add-window-2"));
    expect(await screen.findByTestId("add-window-title")).toHaveTextContent("Add time · Tuesday");
    fireEvent.press(screen.getByTestId("add-window-from"));
    fireEvent(screen.getByTestId("add-window-from-picker"), "valueChange", {}, at("22:00"));
    fireEvent.press(screen.getByTestId("add-window-until"));
    fireEvent(screen.getByTestId("add-window-until-picker"), "valueChange", {}, at("02:00"));
    expect(screen.getByTestId("add-window-midnight")).toHaveTextContent(
      /counts as Tuesday until 02:00 on Wednesday/,
    );
    fireEvent.press(screen.getByTestId("add-window-confirm"));
    expect(await screen.findByTestId("window-chip-2-22:00-02:00")).toBeTruthy();

    fireEvent.press(screen.getByTestId("availability-save"));
    expect(await screen.findByTestId("availability-saved")).toBeTruthy();
    expect(contract.requestsTo(WINDOWS_PUT)[0].body).toEqual(saved);
  });

  it("an exact duplicate cannot be added; a 400 on save is explained", async () => {
    await renderDriverApp(
      {
        [WINDOWS_GET]: ok(WINDOWS),
        [WINDOWS_PUT]: { status: 400, body: { status: 400, message: "duplicate window" } },
      },
      { initialUrl: "/availability-windows" },
    );
    fireEvent.press(await screen.findByTestId("add-window-6"));
    fireEvent.press(await screen.findByTestId("add-window-all-day"));
    expect(screen.getByTestId("add-window-duplicate")).toHaveTextContent(
      "You already have this time on this day.",
    );
    expect(screen.getByTestId("add-window-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("add-window-cancel"));

    fireEvent.press(screen.getByTestId("window-remove-6-00:00-00:00"));
    fireEvent.press(screen.getByTestId("availability-save"));
    expect(await screen.findByTestId("availability-invalid")).toBeTruthy();
  });

  it("Arabic: day names, RTL rows and Western digits", async () => {
    await setAppLanguage("ar");
    await renderDriverApp(
      { [WINDOWS_GET]: ok(WINDOWS) },
      { initialUrl: "/availability-windows", language: "ar" },
    );
    const monday = await screen.findByTestId("day-row-1");
    expect(monday).toHaveTextContent(/^الاثنين/);
    expect(monday).toHaveStyle({ flexDirection: "row-reverse" });
    expect(screen.getByTestId("window-chip-1-07:00-12:00")).toHaveTextContent("07:00–12:00", { exact: false });
    expect(screen.getByTestId("window-chip-6-00:00-00:00")).toHaveTextContent("طوال اليوم", { exact: false });
    expect(screen.getByTestId("day-none-7")).toHaveTextContent("غير متاح");
  });

  // ----------------------------------------------------------- conversion

  it("at T−15 the claim converts: the live ride shows with the scheduled chip and notice", async () => {
    const live = rideFixture({
      kind: "scheduled",
      scheduled: {
        scheduledAt: inHours(0.25),
        claimState: "converted",
        pricedAtRideTime: false,
      },
    });
    const contract = await renderDriverApp({ [ACTIVE_RIDE]: ok(live) });
    await goLive();
    await waitForResync(contract);
    expect(await screen.findByTestId("to-pickup-sheet")).toBeTruthy();
    expect(screen.getByTestId("ride-kind-chip")).toHaveTextContent(/Scheduled · pickup \d\d:\d\d/);
    expect(screen.getByTestId("ride-notice-scheduledLive")).toBeTruthy();
    expect(screen.getByTestId("ride-notice-text")).toHaveTextContent(
      "Your scheduled ride is live — head to the pickup now.",
    );
    await act(async () => {});
  });
});
