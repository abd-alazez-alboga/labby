/**
 * M11-T3 — suspensions and a ride in flight, through the real app routes:
 * - a cold start mid-ride on a WHOLE-suspended account: the backend allows
 *   GET /driver/availability while the ride is in flight (allow-list,
 *   2026-10-16), so the held app reads it and the location stream resumes;
 *   no Report link and no rating prompt (both refused on that account);
 * - the ride hold RELEASING (D-W3): ride cancelled / earnings breakdown
 *   dismissed → the suspended gate shows and the location stream stops;
 * - a ROLE suspension (low_rating) landing mid-ride: the ride keeps going,
 *   then the suspended gate.
 * Own file: the permission queue is module state, and other suites'
 * pending push prompts would hold it.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { renderRouter, screen } from "expo-router/testing-library";

import type { UserProfile } from "../api/auth-types";
import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { driverUser, installContractFetch, seedSession } from "../test-utils/contract";
import type { ContractFetch, MockResponse } from "../test-utils/contract";
import { EARNINGS, earningPage, tripEarningFixture } from "../test-utils/money";
import { mockLocationGranted } from "../test-utils/ride-harness";
import { availabilityFixture, MockSocket } from "../test-utils/realtime";
import {
  completedRide,
  inProgressRide,
  RIDE_ID,
  rideFixture,
} from "../test-utils/rides";
import { coded, ok, PENDING } from "../test-utils/trust";

jest.mock("expo", () => ({
  ...jest.requireActual("expo"),
  isRunningInExpoGo: jest.fn(() => false),
}));

const AVAILABILITY = "GET /api/v1/driver/availability";
const ACTIVE_RIDE = "GET /api/v1/driver/rides/active";
const CANCEL = `POST /api/v1/driver/rides/${RIDE_ID}/cancel`;
const CASH_CONFIRM = `POST /api/v1/driver/rides/${RIDE_ID}/cash-confirm`;
const ME = "GET /api/v1/users/me";

const accountSuspended = () =>
  driverUser({ state: "suspended", suspensionNote: "Fraudulent payment disputes." });

async function openApp(
  user: UserProfile,
  routes: Record<string, MockResponse | MockResponse[]>,
): Promise<ContractFetch> {
  await seedSession(user);
  const contract = installContractFetch({
    [ME]: ok(user),
    "GET /api/v1/meta": ok({ name: "labby-backend", version: "0.1.0" }),
    "GET /api/v1/notifications/unread-count?app=driver": ok({ unread: 0 }),
    "GET /api/v1/driver/offers/open": coded(403, "account_suspended"),
    // Backend allow-list (2026-10-16): readable while a ride is in flight.
    [AVAILABILITY]: ok(
      availabilityFixture({ online: true, onlineSince: "2026-10-16T08:00:00Z" }),
    ),
    "GET /api/v1/chat/quick-replies": ok([]),
    ...routes,
  });
  renderRouter("src/app", { initialUrl: "/" });
  return contract;
}

/** The location stream's socket opened (online + GPS granted). */
async function streamStarted(): Promise<MockSocket> {
  await waitFor(() => expect(MockSocket.instances.length).toBeGreaterThan(0));
  return MockSocket.latest();
}

describe("suspensions and a ride in flight", () => {
  const originalWebSocket = globalThis.WebSocket;
  beforeEach(async () => {
    jest.clearAllMocks();
    MockSocket.reset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
    mockLocationGranted();
    // Push registration resolves (denied), so the permission queue frees up.
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      granted: false,
      status: "denied",
      canAskAgain: false,
    } as unknown as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
  });
  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("whole account, cold start mid-ride: availability read, stream resumes; no Report link, no rating prompt", async () => {
    const contract = await openApp(accountSuspended(), {
      [ACTIVE_RIDE]: ok(inProgressRide()),
    });

    expect(await screen.findByTestId("in-ride-sheet")).toBeTruthy();
    expect(screen.getByTestId("sos-pill")).toBeTruthy();
    await waitFor(() =>
      expect(contract.requestsTo(AVAILABILITY).length).toBeGreaterThan(0),
    );
    await streamStarted();
    expect(screen.queryByTestId("gate-title")).toBeNull();
    // D-W2: reports and ratings are refused on this account — not offered.
    expect(screen.getByTestId("safety-share")).toBeTruthy();
    expect(screen.queryByTestId("safety-report")).toBeNull();
    expect(contract.requestsTo(PENDING)).toHaveLength(0);
  });

  it("hold releases when the ride is cancelled: the account-suspended gate shows and the stream stops", async () => {
    await openApp(accountSuspended(), {
      [ACTIVE_RIDE]: ok(rideFixture()),
      [CANCEL]: ok(rideFixture({ state: "cancelled_by_driver" })),
    });
    expect(await screen.findByTestId("to-pickup-sheet")).toBeTruthy();
    const socket = await streamStarted();

    fireEvent.press(screen.getByTestId("ride-cancel-open"));
    fireEvent.press(await screen.findByTestId("cancel-reason-vehicle_issue"));
    fireEvent.press(screen.getByTestId("cancel-confirm"));

    expect(await screen.findByTestId("gate-title")).toHaveTextContent(
      "Your account is suspended",
    );
    expect(screen.queryByTestId("home-screen")).toBeNull();
    await waitFor(() => expect(socket.closedWith).not.toBeNull());
  });

  it("hold releases when the earnings breakdown is dismissed (cash collected)", async () => {
    await openApp(accountSuspended(), {
      [ACTIVE_RIDE]: ok(completedRide()),
      [CASH_CONFIRM]: ok(completedRide({ paymentStatus: "paid_cash" })),
      [EARNINGS]: ok(earningPage([tripEarningFixture()])),
    });

    fireEvent.press(await screen.findByTestId("cash-received"));
    // Still held while the breakdown shows.
    fireEvent.press(await screen.findByTestId("trip-earnings-done"));

    expect(await screen.findByTestId("gate-title")).toHaveTextContent(
      "Your account is suspended",
    );
    expect(screen.queryByTestId("rate-rider-screen")).toBeNull();
  });

  it("a low_rating ROLE suspension landing mid-ride keeps the ride, then shows the suspended gate", async () => {
    let received: ((event: unknown) => void) | null = null;
    jest
      .mocked(Notifications.addNotificationReceivedListener)
      .mockImplementation((listener) => {
        received = listener as unknown as (event: unknown) => void;
        return { remove: jest.fn() } as unknown as Notifications.EventSubscription;
      });
    const active = driverUser();
    const suspended = driverUser({
      roles: [
        { role: "rider", state: "active" },
        { role: "driver", state: "suspended", suspensionReason: "low_rating" },
      ],
    });
    const contract = await openApp(active, {
      [ME]: [ok(active), ok(suspended)],
      "GET /api/v1/driver/offers/open": { status: 204 },
      [ACTIVE_RIDE]: ok(rideFixture()),
      [CANCEL]: ok(rideFixture({ state: "cancelled_by_driver" })),
      [PENDING]: ok([]),
      "GET /api/v1/driver/performance": { status: 500, body: {} },
      "GET /api/v1/driver/balance": { status: 500, body: {} },
    });
    expect(await screen.findByTestId("to-pickup-sheet")).toBeTruthy();
    const socket = await streamStarted();
    await waitFor(() => expect(contract.requestsTo(ME)).toHaveLength(1));
    await waitFor(() => expect(received).not.toBeNull());

    await act(async () => {
      received?.({
        request: {
          content: {
            data: { notificationId: "n1", category: "account", event: "account.role_suspended" },
          },
        },
      });
    });
    await waitFor(() => expect(contract.requestsTo(ME)).toHaveLength(2));

    // The ride goes on (hold): sheet, SOS — and reporting stays allowed (D-W1).
    expect(screen.getByTestId("to-pickup-sheet")).toBeTruthy();
    expect(screen.getByTestId("safety-report")).toBeTruthy();
    expect(screen.queryByTestId("gate-title")).toBeNull();
    expect(socket.closedWith).toBeNull();

    fireEvent.press(screen.getByTestId("ride-cancel-open"));
    fireEvent.press(await screen.findByTestId("cancel-reason-vehicle_issue"));
    fireEvent.press(screen.getByTestId("cancel-confirm"));

    expect(await screen.findByTestId("gate-title")).toHaveTextContent(
      "Your driver account is suspended",
    );
    expect(screen.getByTestId("gate-reports")).toBeTruthy();
    await waitFor(() => expect(socket.closedWith).not.toBeNull());
  });
});
