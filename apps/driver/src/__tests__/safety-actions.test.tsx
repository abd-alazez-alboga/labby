/**
 * M10-T3 — UC-S-13..16 driver side against comms-v1.yaml: the Chat / Call /
 * Share row on all three active-ride sheets (chat unread badge, call gated
 * on the counterpart's phone), share-link create + per-ride reuse (incl.
 * 409 `already_shared`), and the SOS flow (confirm sheet with the region's
 * emergency number → dialer + silent POST with one retry, never blocking).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { Linking, Share } from "react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { sosSample } from "../safety/sos";
import { MockSocket } from "../test-utils/realtime";
import {
  ACTIVE_RIDE,
  emitPosition,
  goLive,
  mockLocationGranted,
  receive,
  renderDriverApp,
  screen,
  waitForResync,
} from "../test-utils/ride-harness";
import {
  CHAT_MESSAGES,
  CHAT_THREAD,
  chatMessageFrame,
  messagePage,
  QUICK_REPLIES_ROUTE,
  quickRepliesFixture,
  SHARE_LINK,
  SOS,
  threadFixture,
} from "../test-utils/comms";
import {
  arrivedRide,
  inProgressRide,
  RIDE_ID,
  rideFixture,
} from "../test-utils/rides";
import type { MockResponse } from "../test-utils/contract";

const originalWebSocket = globalThis.WebSocket;
const ok = (body: unknown): MockResponse => ({ status: 200, body });
const SHARE_URL = "https://labby.example/share/tok-abc";
const RESOLVE_REGION = "GET /api/v1/regions/resolve?lat=33.5&lng=36.28";
/** goLive's first fix can also trigger a resolve before the boot one lands. */
const RESOLVE_REGION_LIVE = "GET /api/v1/regions/resolve?lat=33.49&lng=36.27";

function regionBody() {
  return {
    id: "9a000000-0000-4000-8000-000000000001",
    name: "Damascus",
    currency: "SYP",
    emergencyNumber: "112",
    serviceTypes: [],
  };
}

function routes(overrides: Record<string, MockResponse | MockResponse[]> = {}) {
  return {
    [ACTIVE_RIDE]: ok(rideFixture()),
    [QUICK_REPLIES_ROUTE]: ok(quickRepliesFixture()),
    [CHAT_THREAD]: ok(threadFixture()),
    [CHAT_MESSAGES]: ok(messagePage([])),
    ...overrides,
  };
}

async function renderActiveRide(
  extraRoutes: Record<string, MockResponse | MockResponse[]> = {},
  options: { region?: boolean } = {},
) {
  const contract = await renderDriverApp(routes(extraRoutes), {
    chat: true,
    region: options.region,
  });
  const socket = await goLive();
  await waitForResync(contract);
  return { contract, socket };
}

describe("safety actions on the ride screens (UC-S-13..16)", () => {
  let openURL: jest.SpyInstance;
  let share: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    MockSocket.reset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
    mockLocationGranted();
    openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" } as never);
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    openURL.mockRestore();
    share.mockRestore();
  });

  it.each([
    ["to-pickup", rideFixture()],
    ["at-pickup", arrivedRide(120000)],
    ["in-ride", inProgressRide()],
  ])("shows Chat / Call / Share on the %s sheet", async (_phase, ride) => {
    await renderActiveRide({ [ACTIVE_RIDE]: ok(ride) });
    await waitFor(() => expect(screen.getByTestId("safety-chat")).toBeTruthy());
    expect(screen.getByTestId("safety-call")).toBeTruthy();
    expect(screen.getByTestId("safety-share")).toBeTruthy();
    expect(screen.getByTestId("sos-pill")).toBeTruthy();
  });

  it("shows the unread badge from the thread and live frames", async () => {
    const { socket } = await renderActiveRide({
      [CHAT_THREAD]: ok(threadFixture({ unreadCount: 1 })),
    });
    await waitFor(() =>
      expect(screen.getByTestId("chat-unread-badge")).toHaveTextContent("1"),
    );
    // A rider message lands while the chat screen is closed: badge grows.
    receive(socket, chatMessageFrame());
    await waitFor(() =>
      expect(screen.getByTestId("chat-unread-badge")).toHaveTextContent("2"),
    );
  });

  it("dials the counterpart with tel: — and hides Call while phone is null (CALL-01)", async () => {
    await renderActiveRide();
    await waitFor(() => expect(screen.getByTestId("safety-call")).toBeTruthy());
    fireEvent.press(screen.getByTestId("safety-call"));
    expect(openURL).toHaveBeenCalledWith("tel:+963955555555");
  });

  it("hides Call when the thread serves no phone", async () => {
    await renderActiveRide({
      [CHAT_THREAD]: ok(
        threadFixture({
          counterpart: {
            role: "rider",
            firstName: "Rana",
            photoUrl: null,
            phone: null,
          },
        }),
      ),
    });
    await waitFor(() => expect(screen.getByTestId("safety-chat")).toBeTruthy());
    expect(screen.queryByTestId("safety-call")).toBeNull();
  });

  it("creates the share link once and reuses the stored url on re-tap (SHARE-01)", async () => {
    const { contract } = await renderActiveRide({
      [SHARE_LINK]: {
        status: 201,
        body: { url: SHARE_URL, createdAt: "2026-10-13T08:00:00Z" },
      },
    });
    await waitFor(() => expect(screen.getByTestId("safety-share")).toBeTruthy());

    fireEvent.press(screen.getByTestId("safety-share"));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({ message: SHARE_URL }),
    );
    expect(contract.requestsTo(SHARE_LINK)).toHaveLength(1);

    // Re-tap: the persisted url is reused — no second POST.
    fireEvent.press(screen.getByTestId("safety-share"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(share).toHaveBeenLastCalledWith({ message: SHARE_URL });
    expect(contract.requestsTo(SHARE_LINK)).toHaveLength(1);
  });

  it("409 already_shared without a stored url: explains, shares nothing", async () => {
    await renderActiveRide({
      [SHARE_LINK]: {
        status: 409,
        body: { status: 409, message: "already shared", code: "already_shared" },
      },
    });
    await waitFor(() => expect(screen.getByTestId("safety-share")).toBeTruthy());
    fireEvent.press(screen.getByTestId("safety-share"));
    await waitFor(() =>
      expect(screen.getByTestId("share-notice-unavailable")).toBeTruthy(),
    );
    expect(share).not.toHaveBeenCalled();
  });

  it("SOS: confirm sheet with the region number → dialer + silent POST (SAFE-01)", async () => {
    const { contract } = await renderActiveRide(
      {
        [RESOLVE_REGION]: ok(regionBody()),
        [RESOLVE_REGION_LIVE]: ok(regionBody()),
        [SOS]: {
          status: 201,
          body: {
            sosEventId: "cc000000-0000-4000-8000-000000000001",
            rideId: RIDE_ID,
            triggeredByRole: "driver",
            lat: 33.5,
            lng: 36.28,
            triggeredAt: "2026-10-13T08:10:00Z",
            createdAt: "2026-10-13T08:10:00Z",
          },
        },
      },
      { region: true },
    );
    emitPosition(33.5, 36.28);

    fireEvent.press(screen.getByTestId("sos-pill"));
    await waitFor(() => expect(screen.getByTestId("sos-sheet")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByTestId("sos-body")).toHaveTextContent(/112/),
    );
    expect(screen.getByTestId("sos-body")).toHaveTextContent(/Damascus/);

    fireEvent.press(screen.getByTestId("sos-confirm"));
    // The dialer opens at once — never gated on the POST.
    expect(openURL).toHaveBeenCalledWith("tel:112");
    await waitFor(() => expect(contract.requestsTo(SOS)).toHaveLength(1));
    const body = contract.requestsTo(SOS)[0].body as Record<string, unknown>;
    expect(body.lat).toBe(33.5);
    expect(body.lng).toBe(36.28);
    expect(typeof body.recordedAt).toBe("string");
    // The sheet is gone; the ride goes on.
    expect(screen.queryByTestId("sos-sheet")).toBeNull();
  });

  it("SOS: a failed POST retries exactly once and never blocks the dialer", async () => {
    const { contract } = await renderActiveRide(
      {
        [RESOLVE_REGION]: ok(regionBody()),
        [RESOLVE_REGION_LIVE]: ok(regionBody()),
        [SOS]: [
          { status: 500, body: { status: 500, message: "boom" } },
          { status: 500, body: { status: 500, message: "boom" } },
        ],
      },
      { region: true },
    );
    emitPosition(33.5, 36.28);

    fireEvent.press(screen.getByTestId("sos-pill"));
    await waitFor(() => expect(screen.getByTestId("sos-sheet")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByTestId("sos-body")).toHaveTextContent(/112/),
    );
    fireEvent.press(screen.getByTestId("sos-confirm"));
    expect(openURL).toHaveBeenCalledWith("tel:112");
    // One retry, then it stops (fire-and-forget).
    await waitFor(() => expect(contract.requestsTo(SOS)).toHaveLength(2));
    await act(async () => {});
    expect(contract.requestsTo(SOS)).toHaveLength(2);
  });

  it("SOS without any GPS fix records the pickup point — the alert is never dropped", async () => {
    const pickup = { lat: 33.55, lng: 36.31, label: "Mezzeh 86" };
    const contract = await renderDriverApp(
      routes({
        [ACTIVE_RIDE]: ok(rideFixture({ pickup })),
        [SOS]: { status: 201, body: {} },
      }),
      { chat: true },
    );
    // Live socket, but the GPS never reported a fix.
    await waitFor(() => expect(MockSocket.instances.length).toBeGreaterThan(0));
    const socket = MockSocket.latest();
    act(() => socket.open());
    act(() => socket.ready());
    await waitForResync(contract);
    await waitFor(() => expect(screen.getByTestId("sos-pill")).toBeTruthy());

    const before = Date.now();
    fireEvent.press(screen.getByTestId("sos-pill"));
    fireEvent.press(screen.getByTestId("sos-confirm"));
    await waitFor(() => expect(contract.requestsTo(SOS)).toHaveLength(1));
    const body = contract.requestsTo(SOS)[0].body as Record<string, unknown>;
    expect(body.lat).toBe(33.55);
    expect(body.lng).toBe(36.31);
    expect(Date.parse(body.recordedAt as string)).toBeGreaterThanOrEqual(before);
  });

  it("SOS sheet without a region number: alert-only copy, no dialer, event still sent", async () => {
    const { contract } = await renderActiveRide(
      {
        [RESOLVE_REGION]: ok({ ...regionBody(), emergencyNumber: null }),
        [RESOLVE_REGION_LIVE]: ok({ ...regionBody(), emergencyNumber: null }),
        [SOS]: { status: 201, body: {} },
      },
      { region: true },
    );
    fireEvent.press(screen.getByTestId("sos-pill"));
    await waitFor(() => expect(screen.getByTestId("sos-sheet")).toBeTruthy());
    expect(screen.getByTestId("sos-body")).toHaveTextContent(
      "Labby support is alerted instantly with your ride and live location.",
    );
    expect(screen.getByTestId("sos-confirm")).toHaveTextContent(
      /Alert Labby support/,
    );

    fireEvent.press(screen.getByTestId("sos-confirm"));
    await waitFor(() => expect(contract.requestsTo(SOS)).toHaveLength(1));
    expect(openURL).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sos-sheet")).toBeNull();
  });

  it("SOS recordedAt is the moment of the tap, not the (stale) GPS fix time", () => {
    const tap = new Date("2026-10-13T08:10:00Z");
    const sample = sosSample(
      {
        lat: 33.5,
        lng: 36.28,
        recordedAt: "2026-10-13T08:02:00Z", // a fix from before a GPS gap
      } as Parameters<typeof sosSample>[0],
      { lat: 33.4, lng: 36.2, label: "Pickup" },
      tap,
    );
    expect(sample).toEqual({
      lat: 33.5,
      lng: 36.28,
      recordedAt: "2026-10-13T08:10:00.000Z",
    });
  });

  it("SOS cancel keeps the ride untouched", async () => {
    await renderActiveRide(
      {
        [RESOLVE_REGION]: ok(regionBody()),
        [RESOLVE_REGION_LIVE]: ok(regionBody()),
      },
      { region: true },
    );
    fireEvent.press(screen.getByTestId("sos-pill"));
    await waitFor(() => expect(screen.getByTestId("sos-sheet")).toBeTruthy());
    fireEvent.press(screen.getByTestId("sos-cancel"));
    expect(screen.queryByTestId("sos-sheet")).toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  });
});
