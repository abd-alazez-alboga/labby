/**
 * M8-T4 — COM-03 / UC-D-16 floor states wired into availability: `blocked`
 * makes the home unmistakable (red offers-paused card, settle steps, GO
 * disabled, "See my balance") and suppresses the generic offers-blocked
 * banner; `warning` shows the amber near-floor banner; `ok` shows neither.
 * The balance refreshes with the availability reads the app already makes.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { availabilityFixture, MockSocket } from "../test-utils/realtime";
import {
  AVAILABILITY,
  mockLocationGranted,
  renderDriverApp,
  screen,
} from "../test-utils/ride-harness";
import {
  BALANCE,
  balanceViewFixture,
  blockedBalanceView,
  okBalanceView,
} from "../test-utils/money";
import type { MockResponse } from "../test-utils/contract";

const originalWebSocket = globalThis.WebSocket;
const ok = (body: unknown): MockResponse => ({ status: 200, body });

describe("balance floor gate (COM-03, UC-D-16)", () => {
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

  it("blocked while OFFLINE: the red card, the settle steps, GO disabled, See my balance", async () => {
    await renderDriverApp(
      {
        [AVAILABILITY]: ok(availabilityFixture()),
        [BALANCE]: ok(blockedBalanceView()),
      },
      { money: true },
    );

    const card = await screen.findByTestId("floor-blocked");
    expect(card).toHaveTextContent("Ride offers are paused", { exact: false });
    expect(screen.getByTestId("floor-blocked-body")).toHaveTextContent(
      "Your debt reached SYP 520,000 — past the SYP 500,000 limit.",
      { exact: false },
    );
    expect(screen.getByTestId("floor-blocked-debt")).toHaveTextContent(
      "SYP 520,000",
      { exact: false },
    );
    expect(screen.getByTestId("settle-steps")).toHaveTextContent(
      "Offers resume automatically",
      { exact: false },
    );
    // The GO button is dead until settlement (COM-03).
    expect(screen.getByTestId("availability-toggle")).toBeDisabled();

    fireEvent.press(screen.getByTestId("floor-blocked-see-balance"));
    expect(await screen.findByTestId("balance-route")).toBeTruthy();
  });

  it("blocked while ONLINE: the red card replaces the generic offers-blocked banner", async () => {
    await renderDriverApp(
      {
        [AVAILABILITY]: ok(
          availabilityFixture({
            online: true,
            offersBlockedReason: "balance_below_floor",
          }),
        ),
        [BALANCE]: ok(blockedBalanceView()),
      },
      { money: true },
    );

    expect(await screen.findByTestId("floor-blocked")).toBeTruthy();
    expect(screen.queryByTestId("offers-blocked")).toBeNull();
    // Going offline stays available.
    expect(screen.getByTestId("availability-toggle")).toBeTruthy();
  });

  it("keeps the generic offers-blocked banner when the balance view is unavailable", async () => {
    await renderDriverApp(
      {
        [AVAILABILITY]: ok(
          availabilityFixture({
            online: true,
            offersBlockedReason: "balance_below_floor",
          }),
        ),
        [BALANCE]: { status: 503, body: { status: 503 } },
      },
      { money: true },
    );
    expect(await screen.findByTestId("offers-blocked")).toBeTruthy();
    expect(screen.queryByTestId("floor-blocked")).toBeNull();
  });

  it("warning: the amber near-floor banner, GO stays available", async () => {
    await renderDriverApp(
      {
        [AVAILABILITY]: ok(availabilityFixture()),
        [BALANCE]: ok(balanceViewFixture()),
      },
      { money: true },
    );

    expect(await screen.findByTestId("floor-warning")).toHaveTextContent(
      "You're close to the limit",
      { exact: false },
    );
    expect(screen.getByTestId("floor-warning-body")).toHaveTextContent(
      "SYP 70,000 to go",
      { exact: false },
    );
    expect(screen.queryByTestId("floor-blocked")).toBeNull();
    expect(screen.getByTestId("availability-toggle")).not.toBeDisabled();
  });

  it("ok: no floor UI at all", async () => {
    await renderDriverApp(
      {
        [AVAILABILITY]: ok(availabilityFixture()),
        [BALANCE]: ok(okBalanceView()),
      },
      { money: true },
    );
    expect(await screen.findByTestId("availability-offline")).toBeTruthy();
    expect(screen.queryByTestId("floor-warning")).toBeNull();
    expect(screen.queryByTestId("floor-blocked")).toBeNull();
  });

  it("re-reads the balance with every fresh availability read (pull-to-refresh)", async () => {
    const contract = await renderDriverApp(
      {
        [AVAILABILITY]: ok(availabilityFixture()),
        [BALANCE]: ok(okBalanceView()),
      },
      { money: true },
    );
    await screen.findByTestId("availability-offline");
    await waitFor(() =>
      expect(contract.requestsTo(BALANCE).length).toBeGreaterThanOrEqual(1),
    );
    const balanceReadsBefore = contract.requestsTo(BALANCE).length;

    // The app's own availability refresh (UC-D-04 pull-to-refresh).
    await act(async () => {
      screen.getByTestId("home-sheet").props.refreshControl.props.onRefresh();
    });

    await waitFor(() =>
      expect(contract.requestsTo(BALANCE).length).toBeGreaterThan(
        balanceReadsBefore,
      ),
    );
  });

  it("renders the blocked state in Arabic", async () => {
    await setAppLanguage("ar");
    await renderDriverApp(
      {
        [AVAILABILITY]: ok(availabilityFixture()),
        [BALANCE]: ok(blockedBalanceView()),
      },
      { money: true, language: "ar" },
    );

    const card = await screen.findByTestId("floor-blocked");
    expect(card).toHaveTextContent("عروض الرحلات متوقفة", { exact: false });
    expect(screen.getByTestId("floor-blocked-debt")).toHaveTextContent("ل.س", { exact: false });
    expect(screen.getByTestId("floor-blocked-debt")).toHaveTextContent(
      "520,000",
      { exact: false },
    );
    expect(screen.getByTestId("floor-blocked-debt")).not.toHaveTextContent(
      /[٠-٩]/u,
    );
    expect(screen.getByTestId("settle-steps")).toHaveTextContent(
      "كيف تعود إلى الطريق",
      { exact: false },
    );
  });
});
