/**
 * M10 review fixes (review-M10 D-W1..D-W6) — the driver chat's exception
 * and alternate paths against comms-v1.yaml:
 * - a chat deep link to ANOTHER ride's thread while a ride is active shows
 *   that thread (and only that ride's pushes are silenced);
 * - the ride leaving the active set (rider cancels) keeps the open thread;
 * - an offline driver (no socket) gets "Go online to chat" instead of the
 *   composer (owner ruling 2026-10-15);
 * - a failed first `GET /chat` and a failed quick-reply catalog fetch are
 *   retried (NFR-U2, CALL-01);
 * - WS errors `chat_closed` / `chat_not_open` / `invalid_message`;
 * - the Arabic (RTL) layout of the chat.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { StyleSheet } from "react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { openChatRideId } from "../notifications/open-chat";
import { availabilityFixture, MockSocket } from "../test-utils/realtime";
import {
  ACTIVE_RIDE,
  AVAILABILITY,
  goLive,
  mockLocationGranted,
  receive,
  renderDriverApp,
  screen,
  waitForResync,
} from "../test-utils/ride-harness";
import {
  CHAT_MESSAGES,
  CHAT_READ,
  CHAT_THREAD,
  chatMessageFixture,
  messagePage,
  QUICK_REPLIES_ROUTE,
  quickRepliesFixture,
  threadFixture,
} from "../test-utils/comms";
import { RIDE_ID, rideFixture, rideFrame } from "../test-utils/rides";
import type { MockResponse } from "../test-utils/contract";

const originalWebSocket = globalThis.WebSocket;
const ok = (body: unknown): MockResponse => ({ status: 200, body });
const SERVER_ERROR: MockResponse = {
  status: 500,
  body: { status: 500, message: "boom" },
};

const RIDER_MSG = chatMessageFixture();
/** An ended ride still in its 24 h tail (lost item), not the active one. */
const OTHER_RIDE_ID = "99999999-0000-4000-8000-000000000009";
const OTHER_MSG = chatMessageFixture({
  messageId: "bb000000-0000-4000-8000-000000000001",
  body: "I left my phone in your car",
});

function chatRoutes(
  overrides: Record<string, MockResponse | MockResponse[]> = {},
) {
  return {
    [ACTIVE_RIDE]: ok(rideFixture()),
    [QUICK_REPLIES_ROUTE]: ok(quickRepliesFixture()),
    [CHAT_THREAD]: ok(threadFixture()),
    [CHAT_MESSAGES]: ok(messagePage([RIDER_MSG])),
    [`${CHAT_MESSAGES}?after=${RIDER_MSG.messageId}`]: ok(messagePage([])),
    [CHAT_READ]: { status: 204 } as MockResponse,
    ...overrides,
  };
}

/** Active ride + chat, live socket, chat opened from the ride sheet. */
async function openChat(
  routes: Record<string, MockResponse | MockResponse[]> = {},
  options: { language?: "en" | "ar" } = {},
) {
  const contract = await renderDriverApp(chatRoutes(routes), {
    chat: true,
    language: options.language,
  });
  const socket = await goLive();
  await waitForResync(contract);
  await waitFor(() => expect(screen.getByTestId("safety-chat")).toBeTruthy());
  fireEvent.press(screen.getByTestId("safety-chat"));
  await waitFor(() =>
    expect(
      screen.getByTestId(`chat-message-${RIDER_MSG.messageId}`),
    ).toBeTruthy(),
  );
  return { contract, socket };
}

/** Types and sends a text; returns the pending bubble's testID. */
function sendText(socket: MockSocket, body: string): string {
  fireEvent.changeText(screen.getByTestId("chat-input"), body);
  fireEvent.press(screen.getByTestId("chat-send"));
  const sends = socket.framesOfType("chat.send");
  const last = sends[sends.length - 1];
  const testID = `chat-message-pending:${String(last.clientMsgId)}`;
  expect(screen.getByTestId(testID)).toBeTruthy();
  return testID;
}

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) ?? {};
}

describe("driver chat — exception paths (review-M10 D-W1..D-W6)", () => {
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

  it("a deep link to another ride's thread shows THAT thread while a ride is active (D-W1)", async () => {
    const contract = await renderDriverApp(
      chatRoutes({
        [`GET /api/v1/rides/${OTHER_RIDE_ID}/chat`]: ok(
          threadFixture({
            rideId: OTHER_RIDE_ID,
            counterpart: {
              role: "rider",
              firstName: "Omar",
              photoUrl: null,
              phone: "+963944444444",
            },
          }),
        ),
        [`GET /api/v1/rides/${OTHER_RIDE_ID}/chat/messages`]: ok(
          messagePage([OTHER_MSG]),
        ),
        [`GET /api/v1/rides/${OTHER_RIDE_ID}/chat/messages?after=${OTHER_MSG.messageId}`]:
          ok(messagePage([])),
        [`POST /api/v1/rides/${OTHER_RIDE_ID}/chat/read`]: { status: 204 },
      }),
      { chat: true },
    );
    const socket = await goLive();
    await waitForResync(contract);
    await waitFor(() => expect(screen.getByTestId("safety-chat")).toBeTruthy());

    // The driver taps ride A's chat push while on ride B.
    act(() => {
      router.push({ pathname: "/chat", params: { rideId: OTHER_RIDE_ID } });
    });

    // Ride A's thread — not the active ride B's.
    await waitFor(() =>
      expect(screen.getByTestId(`chat-message-${OTHER_MSG.messageId}`)).toBeTruthy(),
    );
    expect(screen.getByTestId("chat-title")).toHaveTextContent("Omar");
    expect(
      screen.queryByTestId(`chat-message-${RIDER_MSG.messageId}`),
    ).toBeNull();

    // Banner suppression keys on the ride actually on screen.
    expect(openChatRideId()).toBe(OTHER_RIDE_ID);

    // A reply goes to ride A's rider.
    sendText(socket, "I'll bring it by");
    const sends = socket.framesOfType("chat.send");
    expect(sends[sends.length - 1]).toMatchObject({ rideId: OTHER_RIDE_ID });

    // Back on the ride screen, the active ride's Chat entry is there again.
    fireEvent.press(screen.getByTestId("chat-back"));
    await waitFor(() => expect(screen.getByTestId("safety-chat")).toBeTruthy());
  });

  it("the rider cancelling while the chat is open keeps the thread on screen (D-W2)", async () => {
    const { socket } = await openChat();

    receive(
      socket,
      rideFrame("ride.state", rideFixture({ state: "cancelled_by_rider" })),
    );
    await act(async () => {});

    // Still the thread (the 24 h tail stays writable) — no endless spinner.
    expect(screen.getByTestId("chat-screen")).toBeTruthy();
    expect(screen.queryByTestId("chat-loading")).toBeNull();
    expect(
      screen.getByTestId(`chat-message-${RIDER_MSG.messageId}`),
    ).toBeTruthy();
    expect(screen.getByTestId("chat-input")).toBeTruthy();
    expect(openChatRideId()).toBe(RIDE_ID);
  });

  it("offline driver in the 24 h tail: history + Call, no composer, 'Go online to chat' (D-W3)", async () => {
    await renderDriverApp(
      chatRoutes({
        [ACTIVE_RIDE]: { status: 204 },
        [AVAILABILITY]: ok(availabilityFixture({ online: false })),
      }),
      { chat: true, initialUrl: `/chat?rideId=${RIDE_ID}` },
    );

    await waitFor(() =>
      expect(screen.getByTestId("chat-offline")).toHaveTextContent(
        "Go online to chat",
      ),
    );
    expect(
      screen.getByTestId(`chat-bubble-text-${RIDER_MSG.messageId}`),
    ).toBeTruthy();
    expect(screen.queryByTestId("chat-input")).toBeNull();
    expect(screen.queryByTestId("chat-send")).toBeNull();
    expect(screen.queryByTestId("chat-quick-replies")).toBeNull();
    // The window is open and serves a phone: Call stays (CALL-01).
    expect(screen.getByTestId("chat-call")).toBeTruthy();
  });

  it("offline note in Arabic", async () => {
    await setAppLanguage("ar");
    await renderDriverApp(
      chatRoutes({
        [ACTIVE_RIDE]: { status: 204 },
        [AVAILABILITY]: ok(availabilityFixture({ online: false })),
      }),
      { chat: true, language: "ar", initialUrl: `/chat?rideId=${RIDE_ID}` },
    );
    await waitFor(() =>
      expect(screen.getByTestId("chat-offline")).toHaveTextContent(
        "ابدأ الاتصال للمراسلة",
      ),
    );
  });

  it("a failed GET /chat at ride start is retried — Chat and Call come back (D-W4)", async () => {
    const contract = await renderDriverApp(
      // Fails at ride start AND on the socket-ready resync: only the
      // backoff retry can bring the thread back.
      chatRoutes({
        [CHAT_THREAD]: [SERVER_ERROR, SERVER_ERROR, ok(threadFixture())],
      }),
      { chat: true },
    );
    await goLive();
    await waitForResync(contract);
    await waitFor(() =>
      expect(screen.getByTestId("to-pickup-sheet")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(contract.requestsTo(CHAT_THREAD).length).toBeGreaterThanOrEqual(2),
    );
    expect(screen.queryByTestId("safety-chat")).toBeNull();

    await waitFor(() => expect(screen.getByTestId("safety-chat")).toBeTruthy(), {
      timeout: 8000,
    });
    expect(screen.getByTestId("safety-call")).toBeTruthy();
    expect(contract.requestsTo(CHAT_THREAD).length).toBeGreaterThanOrEqual(3);
  });

  it("a failed quick-reply catalog fetch is retried (D-W5, NFR-U2)", async () => {
    const { contract } = await openChat({
      [QUICK_REPLIES_ROUTE]: [SERVER_ERROR, ok(quickRepliesFixture())],
    });
    await waitFor(() =>
      expect(screen.getByTestId("quick-reply-on_my_way")).toBeTruthy(),
    );
    expect(
      contract.requestsTo(QUICK_REPLIES_ROUTE).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("WS chat_closed: read-only at once, call hidden, pending dropped, thread re-read", async () => {
    const { contract, socket } = await openChat();
    const pending = sendText(socket, "Are you there?");
    const reads = contract.requestsTo(CHAT_THREAD).length;

    receive(socket, { type: "error", code: "chat_closed", message: "closed" });

    expect(screen.getByTestId("chat-read-only")).toBeTruthy();
    expect(screen.queryByTestId("chat-input")).toBeNull();
    expect(screen.queryByTestId("chat-call")).toBeNull();
    expect(screen.queryByTestId(pending)).toBeNull();
    await waitFor(() =>
      expect(contract.requestsTo(CHAT_THREAD).length).toBeGreaterThan(reads),
    );
  });

  it("WS chat_not_open: pending dropped and the thread reloaded", async () => {
    const { contract, socket } = await openChat();
    const pending = sendText(socket, "Hello");
    const reads = contract.requestsTo(CHAT_THREAD).length;

    receive(socket, { type: "error", code: "chat_not_open" });

    expect(screen.queryByTestId(pending)).toBeNull();
    await waitFor(() =>
      expect(contract.requestsTo(CHAT_THREAD).length).toBeGreaterThan(reads),
    );
    expect(screen.getByTestId("chat-input")).toBeTruthy();
  });

  it("WS invalid_message: the refused pending send is dropped, the composer stays", async () => {
    const { socket } = await openChat();
    const pending = sendText(socket, "x");

    receive(socket, { type: "error", code: "invalid_message" });

    expect(screen.queryByTestId(pending)).toBeNull();
    expect(screen.getByTestId("chat-input")).toBeTruthy();
    expect(
      screen.getByTestId(`chat-message-${RIDER_MSG.messageId}`),
    ).toBeTruthy();
  });

  it("Arabic (RTL): own bubbles on the start side, rows mirrored, input right-aligned", async () => {
    await setAppLanguage("ar");
    const { socket } = await openChat({}, { language: "ar" });
    const pending = sendText(socket, "في الطريق");

    // Own (driver) bubble on the left in RTL, the rider's on the right.
    expect(styleOf(pending).alignSelf).toBe("flex-start");
    expect(styleOf(`chat-message-${RIDER_MSG.messageId}`).alignSelf).toBe(
      "flex-end",
    );
    expect(styleOf("chat-header").flexDirection).toBe("row-reverse");
    expect(styleOf("chat-input-row").flexDirection).toBe("row-reverse");
    expect(styleOf("chat-input").textAlign).toBe("right");
  });
});
