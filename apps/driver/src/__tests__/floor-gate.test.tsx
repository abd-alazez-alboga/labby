/**
 * M8-T4 — COM-03 / UC-D-16 floor states wired into availability: `blocked`
 * makes the home unmistakable (red offers-paused card, settle steps, "See
 * my balance") and suppresses the generic offers-blocked banner, while GO
 * stays enabled (UC-D-04 E2: online allowed, no offers — W16); `warning`
 * shows the amber near-floor banner; `ok` shows neither. The balance
 * refreshes with the availability reads the app already makes, and a
 * `driver.balance_*` push re-reads balance AND availability.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

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

// A dev/production build (not Expo Go) so foreground pushes are delivered;
// permission reads stay pending (jest.setup), so registration is inert.
jest.mock("expo", () => ({
  ...jest.requireActual("expo"),
  isRunningInExpoGo: jest.fn(() => false),
}));

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

  it("blocked while OFFLINE: the red card, the settle steps, GO ENABLED, See my balance", async () => {
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
    // UC-D-04 E2 (W16): going online stays allowed — only offers stop.
    expect(screen.getByTestId("availability-toggle")).not.toBeDisabled();

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

  it("an unblock push in the foreground re-reads balance AND availability (W16)", async () => {
    let received: ((notification: Notifications.Notification) => void) | null =
      null;
    jest
      .mocked(Notifications.addNotificationReceivedListener)
      .mockImplementation((listener) => {
        received = listener;
        return { remove: jest.fn() } as unknown as Notifications.EventSubscription;
      });
    const balanceRoute = ok(blockedBalanceView());
    const contract = await renderDriverApp(
      {
        [AVAILABILITY]: ok(availabilityFixture()),
        [BALANCE]: balanceRoute,
      },
      { money: true },
    );
    expect(await screen.findByTestId("floor-blocked")).toBeTruthy();
    await waitFor(() => expect(received).not.toBeNull());
    const balanceReads = contract.requestsTo(BALANCE).length;
    const availabilityReads = contract.requestsTo(AVAILABILITY).length;
    // An admin recorded the settlement: the server now reports `ok`.
    balanceRoute.body = okBalanceView();

    await act(async () => {
      received?.({
        request: {
          content: {
            data: { event: "driver.balance_unblocked", category: "payments" },
          },
        },
      } as unknown as Notifications.Notification);
    });

    await waitFor(() =>
      expect(contract.requestsTo(AVAILABILITY).length).toBeGreaterThan(
        availabilityReads,
      ),
    );
    expect(contract.requestsTo(BALANCE).length).toBeGreaterThan(balanceReads);
    await waitFor(() => expect(screen.queryByTestId("floor-blocked")).toBeNull());
  });

  it("ignores other foreground pushes for the floor", async () => {
    let received: ((notification: Notifications.Notification) => void) | null =
      null;
    jest
      .mocked(Notifications.addNotificationReceivedListener)
      .mockImplementation((listener) => {
        received = listener;
        return { remove: jest.fn() } as unknown as Notifications.EventSubscription;
      });
    const contract = await renderDriverApp(
      {
        [AVAILABILITY]: ok(availabilityFixture()),
        [BALANCE]: ok(okBalanceView()),
      },
      { money: true },
    );
    await screen.findByTestId("availability-offline");
    await waitFor(() => expect(received).not.toBeNull());
    await waitFor(() =>
      expect(contract.requestsTo(BALANCE).length).toBeGreaterThanOrEqual(1),
    );
    const availabilityReads = contract.requestsTo(AVAILABILITY).length;
    await act(async () => {
      received?.({
        request: { content: { data: { event: "ride.completed" } } },
      } as unknown as Notifications.Notification);
    });
    expect(contract.requestsTo(AVAILABILITY)).toHaveLength(availabilityReads);
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
