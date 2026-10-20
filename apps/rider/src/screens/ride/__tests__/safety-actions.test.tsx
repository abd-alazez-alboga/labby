/**
 * M10-T3 on-ride safety actions (UC-S-13..16) on the active-ride screens
 * against contract-shaped mocks (comms-v1.yaml): the Chat tile + unread
 * badge (live from chat.message frames; hidden on a 404 thread), Call
 * gated on counterpart.phone, Share trip (one POST, url persisted per ride
 * and reused; 409 already_shared → notice) and SOS (confirm → dialer with
 * the region emergency number + the silent SOS event with GPS and
 * recordedAt, one retry — sent at once with the best position in hand:
 * the fix warmed while the sheet was open → last known → pickup; no
 * region number → plain `tel:` + the no-number copy).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as Location from "expo-location";
import React from "react";
import { Linking, Share } from "react-native";

import { ChatProvider } from "../../../chat/chat-context";
import { LANGUAGE_STORAGE_KEY, LocaleProvider } from "../../../i18n/locale-context";
import { RegionProvider } from "../../../region/region-context";
import { RideProvider } from "../../../ride/ride-context";
import {
  chatThread,
  MSG_3,
  shareLink,
  sosEvent,
} from "../../../test-utils/comms-fixtures";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  acceptedRide,
  FakeSocket,
  fakeSocketFactory,
  RIDE_ID,
} from "../../../test-utils/ride-fixtures";
import RideScreen from "../ride-screen";
import { SHARE_LINK_KEY_PREFIX } from "../safety-actions";

// Icons render as their name (same pattern as money-flows.test).
jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: MockText } = require("react-native");
  return {
    Ionicons: ({ name }: { name: string }) => (
      <MockText testID={`icon-${name}`}>{name}</MockText>
    ),
  };
});

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };
const locationMock = Location as jest.Mocked<typeof Location>;

const REGION_CONFIG = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Damascus",
  currency: "SYP",
  emergencyNumber: "112",
  serviceTypes: [],
  waitGraceMin: 5,
  waitPerMinRate: 500,
};

const ACTIVE = "GET /api/v1/rides/active";
const RIDE = `GET /api/v1/rides/${RIDE_ID}`;
const THREAD = `GET /api/v1/rides/${RIDE_ID}/chat`;
const SHARE = `POST /api/v1/rides/${RIDE_ID}/share-links`;
const SOS = `POST /api/v1/rides/${RIDE_ID}/sos`;

function grantLocation() {
  const permission = {
    granted: true,
    status: "granted" as Location.PermissionStatus,
    canAskAgain: true,
    expires: "never" as const,
  };
  locationMock.requestForegroundPermissionsAsync.mockResolvedValue(permission);
  locationMock.getForegroundPermissionsAsync.mockResolvedValue(permission);
  locationMock.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 33.5201, longitude: 36.2802 },
  } as Location.LocationObject);
  locationMock.getLastKnownPositionAsync.mockResolvedValue(null);
  locationMock.watchPositionAsync.mockResolvedValue({
    remove: jest.fn(),
  } as unknown as Location.LocationSubscription);
}

function routes(extra: Record<string, unknown> = {}) {
  return {
    "GET /api/v1/regions/resolve": { status: 200, body: REGION_CONFIG },
    [ACTIVE]: { status: 200, body: acceptedRide() },
    [RIDE]: { status: 200, body: acceptedRide() },
    [THREAD]: { status: 200, body: chatThread({ unreadCount: 2 }) },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

function renderRide() {
  return render(
    <LocaleProvider>
      <RegionProvider>
        <RideProvider socketFactory={fakeSocketFactory}>
          <ChatProvider>
            <RideScreen rideId={RIDE_ID} />
          </ChatProvider>
        </RideProvider>
      </RegionProvider>
    </LocaleProvider>,
  );
}

async function connect(): Promise<FakeSocket> {
  await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeSocket.latest();
  await act(async () => socket.open());
  await waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));
  await act(async () => socket.receive({ type: "ready", userId: "u-1" }));
  return socket;
}

let openUrl: jest.SpyInstance;
let share: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  FakeSocket.reset();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
  grantLocation();
  openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  share = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: "sharedAction" } as never);
});

afterEach(() => {
  openUrl.mockRestore();
  share.mockRestore();
});

describe("chat + call actions (UC-S-13/14)", () => {
  it("shows Chat with the unread badge (live from frames) and opens the chat", async () => {
    mockApi(routes());
    await renderRide();

    expect(await screen.findByTestId("safety-chat")).toBeOnTheScreen();
    expect(screen.getByTestId("safety-chat-unread")).toHaveTextContent("2");

    const socket = await connect();
    await act(async () =>
      socket.receive({
        type: "chat.message",
        rideId: RIDE_ID,
        messageId: MSG_3,
        senderRole: "driver",
        kind: "text",
        body: "Stuck in traffic",
        sentAt: "2026-10-13T09:33:00Z",
      }),
    );
    // Reconnect re-reads the thread (2), then the frame adds one.
    await waitFor(() =>
      expect(screen.getByTestId("safety-chat-unread")).toHaveTextContent("3"),
    );

    await fireEvent.press(screen.getByTestId("safety-chat"));
    expect(mockPush).toHaveBeenCalledWith(`/chat/${RIDE_ID}`);
  });

  it("Call opens tel: with the counterpart's phone", async () => {
    mockApi(routes());
    await renderRide();

    await fireEvent.press(await screen.findByTestId("safety-call"));
    expect(openUrl).toHaveBeenCalledWith("tel:+963955000111");
  });

  it("hides Call while the phone is null (CALL-01 window)", async () => {
    mockApi(
      routes({
        [THREAD]: {
          status: 200,
          body: chatThread({
            counterpart: {
              role: "driver",
              firstName: "Samer",
              photoUrl: null,
              phone: null,
            },
          }),
        },
      }),
    );
    await renderRide();
    expect(await screen.findByTestId("safety-chat")).toBeOnTheScreen();
    expect(screen.queryByTestId("safety-call")).toBeNull();
  });

  it("hides Chat and Call on a 404 thread (window `none`)", async () => {
    const api = mockApi(
      routes({
        [THREAD]: { status: 404, body: { status: 404, message: "No thread" } },
      }),
    );
    await renderRide();
    expect(await screen.findByTestId("safety-share")).toBeOnTheScreen();
    await waitFor(() =>
      expect(api.callsTo("GET", `/api/v1/rides/${RIDE_ID}/chat`).length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId("safety-chat")).toBeNull();
    expect(screen.queryByTestId("safety-call")).toBeNull();
  });

  it("renders the action row in Arabic", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi(routes());
    await renderRide();

    expect(await screen.findByText("محادثة")).toBeOnTheScreen();
    expect(screen.getByText("اتصال")).toBeOnTheScreen();
    expect(screen.getByText("مشاركة الرحلة")).toBeOnTheScreen();
  });
});

describe("share trip (UC-S-15, SHARE-01)", () => {
  it("creates the link once, persists it per ride and reuses it on re-tap", async () => {
    const api = mockApi(
      routes({ [SHARE]: { status: 201, body: shareLink() } }),
    );
    await renderRide();

    await fireEvent.press(await screen.findByTestId("safety-share"));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        message: "https://labby.example/share/tok-123",
      }),
    );
    expect(
      await AsyncStorage.getItem(`${SHARE_LINK_KEY_PREFIX}${RIDE_ID}`),
    ).toBe("https://labby.example/share/tok-123");

    await fireEvent.press(screen.getByTestId("safety-share"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(share).toHaveBeenLastCalledWith({
      message: "https://labby.example/share/tok-123",
    });
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/share-links`)).toHaveLength(1);
  });

  it("reuses the stored url after a restart without calling the API (no 409)", async () => {
    await AsyncStorage.setItem(
      `${SHARE_LINK_KEY_PREFIX}${RIDE_ID}`,
      "https://labby.example/share/kept",
    );
    const api = mockApi(
      routes({
        [SHARE]: { status: 409, body: { status: 409, code: "already_shared" } },
      }),
    );
    await renderRide();

    await fireEvent.press(await screen.findByTestId("safety-share"));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        message: "https://labby.example/share/kept",
      }),
    );
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/share-links`)).toHaveLength(0);
  });

  it("409 already_shared with the url lost: tells the user, no share sheet, no crash", async () => {
    mockApi(
      routes({
        [SHARE]: {
          status: 409,
          body: { status: 409, message: "Already shared", code: "already_shared" },
        },
      }),
    );
    await renderRide();

    await fireEvent.press(await screen.findByTestId("safety-share"));
    expect(await screen.findByTestId("safety-share-notice")).toHaveTextContent(
      "Trip sharing was already started for this ride — the link can't be created again.",
    );
    expect(share).not.toHaveBeenCalled();
  });
});

describe("SOS (UC-S-16, SAFE-01)", () => {
  it("confirm sheet names the region number; confirm opens the dialer and fires the event silently", async () => {
    const api = mockApi(routes({ [SOS]: { status: 201, body: sosEvent() } }));
    await renderRide();

    await fireEvent.press(await screen.findByTestId("ride-sos"));
    expect(await screen.findByText("Emergency SOS")).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId("sos-confirm")).toHaveTextContent(
        "Call 112 — support alerted",
      ),
    );
    expect(
      screen.getByText(
        "Your phone will call 112, the emergency number for Damascus. Labby support is alerted instantly with your ride and live location.",
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("sos-confirm"));
    // Dialer first, synchronously — never waiting on the POST.
    expect(openUrl).toHaveBeenCalledWith("tel:112");
    await waitFor(() =>
      expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)).toHaveLength(1),
    );
    const body = api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)[0]
      .body as { lat: number; lng: number; recordedAt: string };
    expect(body.lat).toBe(33.5201);
    expect(body.lng).toBe(36.2802);
    expect(Number.isNaN(Date.parse(body.recordedAt))).toBe(false);
    expect(screen.queryByTestId("sos-sheet")).toBeNull();
  });

  it("retries the SOS event once on failure; the dialer is not blocked", async () => {
    const api = mockApi(
      routes({
        [SOS]: [
          { status: 500, body: { status: 500, message: "boom" } },
          { status: 201, body: sosEvent() },
        ],
      }),
    );
    await renderRide();

    await fireEvent.press(await screen.findByTestId("ride-sos"));
    await fireEvent.press(await screen.findByTestId("sos-confirm"));
    expect(openUrl).toHaveBeenCalledWith("tel:112");
    await waitFor(() =>
      expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)).toHaveLength(2),
    );
  });

  it("Cancel closes the sheet without dialing or alerting", async () => {
    const api = mockApi(routes({ [SOS]: { status: 201, body: sosEvent() } }));
    await renderRide();

    await fireEvent.press(await screen.findByTestId("ride-sos"));
    await fireEvent.press(await screen.findByTestId("sos-cancel"));
    expect(screen.queryByTestId("sos-sheet")).toBeNull();
    expect(openUrl).not.toHaveBeenCalled();
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)).toHaveLength(0);
  });

  /** Lets the region resolve first, then makes every fresh fix hang. */
  async function hangFreshFixAfterRegion(api: ReturnType<typeof mockApi>) {
    await waitFor(() =>
      expect(api.callsTo("GET", "/api/v1/regions/resolve")).toHaveLength(1),
    );
    locationMock.getCurrentPositionAsync.mockImplementation(
      () => new Promise(() => {}),
    );
  }

  it("does not wait for a hung fresh fix: sends at once with the last known position", async () => {
    const api = mockApi(routes({ [SOS]: { status: 201, body: sosEvent() } }));
    locationMock.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 33.5111, longitude: 36.2999 },
    } as Location.LocationObject);
    await renderRide();
    await screen.findByTestId("ride-sos");
    await hangFreshFixAfterRegion(api);

    await fireEvent.press(screen.getByTestId("ride-sos"));
    await waitFor(() =>
      expect(screen.getByTestId("sos-confirm")).toHaveTextContent(
        "Call 112 — support alerted",
      ),
    );
    await fireEvent.press(screen.getByTestId("sos-confirm"));
    expect(openUrl).toHaveBeenCalledWith("tel:112");
    // Well inside the old 4 s fresh-fix wait (waitFor gives up at 1 s).
    await waitFor(
      () =>
        expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)).toHaveLength(1),
      { timeout: 500 },
    );
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)[0].body).toMatchObject({
      lat: 33.5111,
      lng: 36.2999,
    });
  });

  it("falls back to the pickup when there is no fix and no last known position", async () => {
    const api = mockApi(routes({ [SOS]: { status: 201, body: sosEvent() } }));
    locationMock.getLastKnownPositionAsync.mockResolvedValue(null);
    await renderRide();
    await screen.findByTestId("ride-sos");
    await hangFreshFixAfterRegion(api);

    await fireEvent.press(screen.getByTestId("ride-sos"));
    await fireEvent.press(await screen.findByTestId("sos-confirm"));
    await waitFor(
      () =>
        expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)).toHaveLength(1),
      { timeout: 500 },
    );
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)[0].body).toMatchObject({
      lat: 33.5138,
      lng: 36.2765,
    });
  });

  it("falls back to the pickup when the location reads fail", async () => {
    const api = mockApi(routes({ [SOS]: { status: 201, body: sosEvent() } }));
    await renderRide();
    await screen.findByTestId("ride-sos");
    await waitFor(() =>
      expect(api.callsTo("GET", "/api/v1/regions/resolve")).toHaveLength(1),
    );
    locationMock.getCurrentPositionAsync.mockRejectedValue(new Error("off"));
    locationMock.getLastKnownPositionAsync.mockRejectedValue(new Error("off"));

    await fireEvent.press(screen.getByTestId("ride-sos"));
    await fireEvent.press(await screen.findByTestId("sos-confirm"));
    await waitFor(() =>
      expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)).toHaveLength(1),
    );
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)[0].body).toMatchObject({
      lat: 33.5138,
      lng: 36.2765,
    });
  });

  it("no region emergency number: plain dialer, the no-number copy, the event still fires", async () => {
    const api = mockApi(
      routes({
        "GET /api/v1/regions/resolve": {
          status: 404,
          body: { status: 404, message: "Outside every region" },
        },
        [SOS]: { status: 201, body: sosEvent() },
      }),
    );
    await renderRide();
    await waitFor(() =>
      expect(api.callsTo("GET", "/api/v1/regions/resolve")).toHaveLength(1),
    );

    await fireEvent.press(await screen.findByTestId("ride-sos"));
    expect(await screen.findByTestId("sos-confirm")).toHaveTextContent(
      "Call emergency — support alerted",
    );
    expect(
      screen.getByText(
        "Your phone will open the dialer to call emergency services. Labby support is alerted instantly with your ride and live location.",
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("sos-confirm"));
    expect(openUrl).toHaveBeenCalledWith("tel:");
    await waitFor(() =>
      expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/sos`)).toHaveLength(1),
    );
  });

  it("renders the SOS confirm in Arabic", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi(routes());
    await renderRide();

    await fireEvent.press(await screen.findByTestId("ride-sos"));
    expect(await screen.findByText("نداء استغاثة")).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId("sos-confirm")).toHaveTextContent(
        "اتصال بـ112 — تم تنبيه الدعم",
      ),
    );
  });
});

describe("I'm coming on the wait-charge sheet (RiderWaitCharge)", () => {
  const charging = () =>
    acceptedRide({
      state: "driver_arrived",
      waitGraceEndsAt: new Date(Date.now() - 60_000).toISOString(),
    });

  it("sends the rider_coming quick reply once", async () => {
    mockApi(
      routes({
        [ACTIVE]: { status: 200, body: charging() },
        [RIDE]: { status: 200, body: charging() },
      }),
    );
    await renderRide();
    const socket = await connect();

    const button = await screen.findByTestId("ride-im-coming");
    expect(button).toHaveTextContent("I'm coming");
    await fireEvent.press(button);

    const frames = socket.sent.filter((frame) => frame.type === "chat.send");
    expect(frames).toEqual([
      expect.objectContaining({
        type: "chat.send",
        rideId: RIDE_ID,
        kind: "quick_reply",
        quickReplyCode: "rider_coming",
        clientMsgId: expect.any(String),
      }),
    ]);
    expect(screen.getByTestId("ride-im-coming")).toHaveTextContent(
      "Your driver knows you're coming",
    );
    expect(
      screen.getByTestId("ride-im-coming").props.accessibilityState,
    ).toEqual(expect.objectContaining({ disabled: true }));
  });

  it("is not offered while the free waiting time runs", async () => {
    const free = acceptedRide({
      state: "driver_arrived",
      waitGraceEndsAt: new Date(Date.now() + 120_000).toISOString(),
    });
    mockApi(
      routes({
        [ACTIVE]: { status: 200, body: free },
        [RIDE]: { status: 200, body: free },
      }),
    );
    await renderRide();
    expect(await screen.findByTestId("ride-wait-countdown")).toBeOnTheScreen();
    expect(screen.queryByTestId("ride-im-coming")).toBeNull();
  });
});
