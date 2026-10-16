/**
 * M11-T3 — suspended states against auth-v1 / trust-v1 mocks, through the
 * real app routes: the driver role suspended for a low rating (with the
 * region's rule) or manually (with the admin's note), "Riding still works"
 * only with an active rider role, the unchanged document-expired gate, the
 * whole-account suspension, a 403 `account_suspended` re-reading the
 * profile, an M11 account push re-reading it, and a ride in flight that
 * keeps working (ride + SOS) after the account was suspended.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { renderRouter, screen } from "expo-router/testing-library";
import React from "react";
import { Text } from "react-native";

import type { UserProfile } from "../api/auth-types";
import { getDriverPerformance } from "../api/trust";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { clearSession, getSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import {
  driverUser,
  installContractFetch,
  seedSession,
} from "../test-utils/contract";
import type { MockResponse } from "../test-utils/contract";
import { inProgressRide, RIDE_ID } from "../test-utils/rides";
import { todayIso } from "../onboarding/dates";
import {
  EARNINGS,
  earningPage,
  summaryFixture,
  summaryRoute,
  tripEarningFixture,
} from "../test-utils/money";
import {
  coded,
  MY_REPORTS,
  ok,
  PENDING,
  pendingFixture,
  PERFORMANCE,
  performanceFixture,
  RATE,
  reportFixture,
} from "../test-utils/trust";

// A dev/production build (not Expo Go) so foreground pushes are delivered.
jest.mock("expo", () => ({
  ...jest.requireActual("expo"),
  isRunningInExpoGo: jest.fn(() => false),
}));

const ME = "GET /api/v1/users/me";

function suspendedDriver(
  role: Partial<UserProfile["roles"][number]>,
  overrides: Partial<UserProfile> = {},
): UserProfile {
  return driverUser({
    roles: [
      { role: "rider", state: "active" },
      { role: "driver", state: "suspended", ...role },
    ],
    ...overrides,
  });
}

async function openApp(
  user: UserProfile,
  routes: Record<string, MockResponse | MockResponse[]> = {},
) {
  await seedSession(user);
  const contract = installContractFetch({
    [ME]: ok(user),
    "GET /api/v1/meta": ok({ name: "labby-backend", version: "0.1.0" }),
    "GET /api/v1/notifications/unread-count?app=driver": ok({ unread: 0 }),
    "GET /api/v1/driver/offers/open": { status: 204 },
    "GET /api/v1/driver/rides/active": { status: 204 },
    ...routes,
  });
  renderRouter("src/app", { initialUrl: "/" });
  return contract;
}

describe("suspended states (USR-04..06)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("low_rating: the region's rule with the snapshot average, riding still works, earnings reachable", async () => {
    const contract = await openApp(suspendedDriver({ suspensionReason: "low_rating" }), {
      [PERFORMANCE]: ok(
        performanceFixture({
          rating: { role: "driver", average: 2.94, snapshotAt: null },
        }),
      ),
    });

    expect(await screen.findByTestId("gate-title")).toHaveTextContent(
      "Your driver account is suspended",
    );
    expect(screen.getByTestId("gate-body")).toHaveTextContent(
      "You can't go online or receive offers. Your earnings and balance are unchanged.",
    );
    expect(await screen.findByTestId("gate-reason-text")).toHaveTextContent(
      "Your average rating fell below 3.0 after 20 or more rated rides (your average: 2.94).",
    );
    expect(screen.getByTestId("gate-reason")).toHaveTextContent("Reason", { exact: false });
    expect(screen.getByTestId("gate-riding-text")).toHaveTextContent(
      "Your rider account is active — you can still book rides in the Labby app.",
    );
    expect(screen.getByTestId("gate-suspended-footer")).toHaveTextContent(
      "Our team reviews every rating suspension. You'll get a notification if your account is reactivated.",
    );
    // No contact-support action (owner decision).
    expect(screen.queryByText(/support/i)).toBeNull();
    expect(screen.queryByTestId("gate-renew")).toBeNull();

    fireEvent.press(screen.getByTestId("gate-view-money"));
    expect(await screen.findByTestId("earnings-screen")).toBeTruthy();
    expect(contract.requestsTo(PERFORMANCE)).toHaveLength(1);
  });

  it("low_rating without a snapshot average: the rule only, no suffix", async () => {
    await openApp(suspendedDriver({ suspensionReason: "low_rating" }), {
      [PERFORMANCE]: ok(
        performanceFixture({ rating: { role: "driver", average: null, snapshotAt: null } }),
      ),
    });
    expect(await screen.findByTestId("gate-reason-text")).toHaveTextContent(
      "Your average rating fell below 3.0 after 20 or more rated rides.",
    );
  });

  it("role suspension keeps \"Your reports\" reachable (D-W1)", async () => {
    await openApp(suspendedDriver({ suspensionReason: "low_rating" }), {
      [PERFORMANCE]: { status: 500, body: {} },
      [MY_REPORTS]: ok({
        items: [reportFixture({ id: "r1", status: "substantiated", resolvedAt: "2026-10-15T10:00:00Z" })],
        page: 0,
        size: 20,
        totalElements: 1,
      }),
    });
    fireEvent.press(await screen.findByTestId("gate-reports"));
    expect(await screen.findByTestId("report-status-r1")).toHaveTextContent("Action taken");
  });

  it("role suspension keeps rating: the prompt shows on the gate (\"Submit rating\", no going online)", async () => {
    const contract = await openApp(suspendedDriver({ suspensionReason: "manual", suspensionNote: "n" }), {
      [PENDING]: ok([pendingFixture()]),
      [RATE]: { status: 204 },
    });
    expect(await screen.findByTestId("rate-rider-screen")).toBeTruthy();
    expect(screen.getByTestId("rate-submit")).toHaveTextContent("Submit rating");
    fireEvent.press(screen.getByTestId("rate-star-4"));
    fireEvent.press(screen.getByTestId("rate-submit"));

    expect(await screen.findByTestId("gate-title")).toHaveTextContent(
      "Your driver account is suspended",
    );
    expect(contract.requestsTo(RATE)[0].body).toEqual({ score: 4, comment: null });
    expect(contract.requestsTo("PUT /api/v1/driver/availability")).toHaveLength(0);
  });

  it("role suspension keeps the Trips rating chip (skip → earnings → chip)", async () => {
    await openApp(suspendedDriver({ suspensionReason: "manual", suspensionNote: "n" }), {
      [PENDING]: ok([pendingFixture()]),
      [summaryRoute("weekly", todayIso())]: ok(summaryFixture()),
      [EARNINGS]: ok(earningPage([tripEarningFixture()])),
    });
    fireEvent.press(await screen.findByTestId("rate-skip"));
    fireEvent.press(await screen.findByTestId("gate-view-money"));
    expect(await screen.findByTestId(`trip-rate-${RIDE_ID}`)).toHaveTextContent(
      "Rate Rana",
      { exact: false },
    );
  });

  it("whole-account suspension: no rating prompt at all", async () => {
    const contract = await openApp(driverUser({ state: "suspended", suspensionNote: "n" }), {
      [PENDING]: ok([pendingFixture()]),
    });
    expect(await screen.findByTestId("gate-title")).toHaveTextContent("Your account is suspended");
    expect(screen.queryByTestId("rate-rider-screen")).toBeNull();
    expect(screen.queryByTestId("gate-reports")).toBeNull();
    expect(contract.requestsTo(PENDING)).toHaveLength(0);
  });

  it("low_rating without a readable rule falls back to a generic reason", async () => {
    await openApp(suspendedDriver({ suspensionReason: "low_rating" }), {
      [PERFORMANCE]: { status: 500, body: {} },
    });
    expect(await screen.findByTestId("gate-reason-text")).toHaveTextContent(
      "Your average rating fell below the minimum for your region.",
    );
  });

  it("manual: the admin's note, from the Labby team; no riding card when the rider role is suspended too", async () => {
    await openApp(
      driverUser({
        roles: [
          { role: "rider", state: "suspended", suspensionReason: "manual" },
          {
            role: "driver",
            state: "suspended",
            suspensionReason: "manual",
            suspensionNote: "Repeated refusals to start the meter.",
          },
        ],
      }),
    );

    expect(await screen.findByTestId("gate-reason-text")).toHaveTextContent(
      "“Repeated refusals to start the meter.”",
    );
    expect(screen.getByTestId("gate-reason")).toHaveTextContent(
      "Reason · from the Labby team",
      { exact: false },
    );
    expect(screen.queryByTestId("gate-riding")).toBeNull();
    expect(screen.getByTestId("gate-suspended-footer")).toHaveTextContent(
      "You'll get a notification if your account is reactivated.",
    );
    expect(screen.getByTestId("gate-view-money")).toBeTruthy();
  });

  it("document_expired stays the renewal gate (unchanged)", async () => {
    await openApp(suspendedDriver({ suspensionReason: "document_expired" }));
    expect(await screen.findByTestId("gate-expired")).toBeTruthy();
    expect(screen.getByTestId("gate-title")).toHaveTextContent(
      "Driving paused: a document expired",
    );
    expect(screen.getByTestId("gate-renew")).toBeTruthy();
    expect(screen.queryByTestId("gate-view-money")).toBeNull();
    // D-W1: reporting stays allowed on a role suspension.
    expect(screen.getByTestId("gate-reports")).toBeTruthy();
  });

  it("whole-account suspension: the note, no earnings link, no riding card", async () => {
    await openApp(
      driverUser({
        state: "suspended",
        suspensionNote: "Fraudulent payment disputes.",
      }),
      { "GET /api/v1/driver/offers/open": coded(403, "account_suspended") },
    );

    expect(await screen.findByTestId("gate-title")).toHaveTextContent(
      "Your account is suspended",
    );
    expect(screen.getByTestId("gate-body")).toHaveTextContent(
      "You can't drive or book rides while your account is suspended.",
    );
    expect(screen.getByTestId("gate-reason-text")).toHaveTextContent(
      "“Fraudulent payment disputes.”",
    );
    expect(screen.queryByTestId("gate-riding")).toBeNull();
    expect(screen.queryByTestId("gate-view-money")).toBeNull();
    expect(screen.queryByTestId("home-screen")).toBeNull();
    expect(screen.getByTestId("gate-logout")).toBeTruthy();
  });

  it("a ride in flight keeps working after the account was suspended (ride + SOS)", async () => {
    await openApp(driverUser({ state: "suspended", suspensionNote: "x" }), {
      "GET /api/v1/driver/rides/active": ok(inProgressRide()),
      "GET /api/v1/driver/offers/open": coded(403, "account_suspended"),
      "GET /api/v1/driver/availability": coded(403, "account_suspended"),
      "GET /api/v1/chat/quick-replies": ok([]),
    });

    expect(await screen.findByTestId("in-ride-sheet")).toBeTruthy();
    expect(screen.getByTestId("sos-pill")).toBeTruthy();
    expect(screen.queryByTestId("gate-title")).toBeNull();
  });

  it("an account push (account.role_suspended) re-reads the profile → the suspended screen", async () => {
    const active = driverUser();
    const suspended = suspendedDriver({
      suspensionReason: "manual",
      suspensionNote: "Under review.",
    });
    let received: ((event: unknown) => void) | null = null;
    jest
      .mocked(Notifications.addNotificationReceivedListener)
      .mockImplementation((listener) => {
        received = listener as unknown as (event: unknown) => void;
        return { remove: jest.fn() } as unknown as Notifications.EventSubscription;
      });
    const contract = await openApp(active, {
      [ME]: [ok(active), ok(suspended)],
      "GET /api/v1/driver/availability": ok({
        online: false,
        canGoOnline: true,
        streamIntervalSeconds: 5,
        staleAfterSeconds: 30,
      }),
    });
    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    await waitFor(() => expect(contract.requestsTo(ME)).toHaveLength(1));
    await waitFor(() => expect(received).not.toBeNull());

    await act(async () => {
      received?.({
        request: {
          content: {
            data: {
              notificationId: "n1",
              category: "account",
              event: "account.role_suspended",
            },
          },
        },
      });
    });

    expect(await screen.findByTestId("gate-reason-text")).toHaveTextContent("“Under review.”");
    expect(getSession()?.user.roles[1].state).toBe("suspended");
  });
});

function StateProbe() {
  const { user } = useAuth();
  return <Text testID="probe">{user?.state ?? "none"}</Text>;
}

describe("403 account_suspended (USR-06)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
  });

  it("re-reads the profile once when a feature is refused with account_suspended", async () => {
    await seedSession(driverUser());
    const contract = installContractFetch({
      [PERFORMANCE]: coded(403, "account_suspended"),
      [ME]: ok(driverUser({ state: "suspended", suspensionNote: "n" })),
    });
    renderRouter(
      {
        _layout: () => {
          const { Slot } = jest.requireActual("expo-router");
          return (
            <AuthProvider>
              <Slot />
            </AuthProvider>
          );
        },
        index: () => <StateProbe />,
      },
      { initialUrl: "/" },
    );
    expect(await screen.findByTestId("probe")).toHaveTextContent("active");

    await expect(getDriverPerformance()).rejects.toMatchObject({ status: 403 });
    expect(await screen.findByText("suspended")).toBeTruthy();
    expect(contract.requestsTo(ME)).toHaveLength(1);

    // Already suspended: a further refusal does not re-read again.
    await expect(getDriverPerformance()).rejects.toMatchObject({ status: 403 });
    await act(async () => {});
    expect(contract.requestsTo(ME)).toHaveLength(1);
  });
});
