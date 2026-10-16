/**
 * M11-T3 follow-up — a cold start in the middle of a ride on a WHOLE-
 * suspended account: the backend now allows GET /driver/availability while
 * the ride is in flight (allow-list, 2026-10-16), so the held driver app
 * reads it and the location stream resumes. Own file: the permission queue
 * is module state, and other suites' pending push prompts would hold it.
 */
import { waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { renderRouter, screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { driverUser, installContractFetch, seedSession } from "../test-utils/contract";
import { mockLocationGranted } from "../test-utils/ride-harness";
import { availabilityFixture, MockSocket } from "../test-utils/realtime";
import { inProgressRide } from "../test-utils/rides";
import { coded, ok } from "../test-utils/trust";

jest.mock("expo", () => ({
  ...jest.requireActual("expo"),
  isRunningInExpoGo: jest.fn(() => false),
}));

describe("suspended account, ride in flight (cold start)", () => {
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

  it("reads availability again and resumes the location stream", async () => {
    const user = driverUser({ state: "suspended", suspensionNote: "x" });
    await seedSession(user);
    const contract = installContractFetch({
      "GET /api/v1/users/me": ok(user),
      "GET /api/v1/meta": ok({ name: "labby-backend", version: "0.1.0" }),
      "GET /api/v1/notifications/unread-count?app=driver": ok({ unread: 0 }),
      "GET /api/v1/driver/rides/active": ok(inProgressRide()),
      "GET /api/v1/driver/offers/open": coded(403, "account_suspended"),
      "GET /api/v1/driver/availability": ok(
        availabilityFixture({ online: true, onlineSince: "2026-10-16T08:00:00Z" }),
      ),
      "GET /api/v1/chat/quick-replies": ok([]),
    });
    renderRouter("src/app", { initialUrl: "/" });

    expect(await screen.findByTestId("in-ride-sheet")).toBeTruthy();
    expect(screen.getByTestId("sos-pill")).toBeTruthy();
    await waitFor(() =>
      expect(contract.requestsTo("GET /api/v1/driver/availability").length).toBeGreaterThan(0),
    );
    // Online + GPS granted → the location stream (socket) starts again.
    await waitFor(() => expect(MockSocket.instances.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("gate-title")).toBeNull();
  });
});
