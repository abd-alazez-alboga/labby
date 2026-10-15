/**
 * M10-T3 — UC-S-13/14 driver side against comms-v1.yaml: the chat screen
 * (header with the rider's name, context and call button), one-tap quick
 * replies that send IMMEDIATELY (NFR-U2), text sends with optimistic
 * bubbles, the sender echo as delivery ack, reconnect backfill + resend
 * with the SAME clientMsgId (dedup), read markers, window states
 * (open / read_only / none) and the `chat` push deep link.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { hrefForLink, NOTIFICATIONS_HREF } from "../notifications/deep-links";
import { MockSocket } from "../test-utils/realtime";
import {
  ACTIVE_RIDE,
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
  chatMessageFrame,
  messagePage,
  QUICK_REPLIES_ROUTE,
  quickRepliesFixture,
  threadFixture,
} from "../test-utils/comms";
import { RIDE_ID, rideFixture } from "../test-utils/rides";
import type { MockResponse } from "../test-utils/contract";

const originalWebSocket = globalThis.WebSocket;
const ok = (body: unknown): MockResponse => ({ status: 200, body });
const NOT_FOUND: MockResponse = {
  status: 404,
  body: { status: 404, message: "no thread" },
};

const RIDER_MSG = chatMessageFixture();

function chatRoutes(
  overrides: Record<string, MockResponse | MockResponse[]> = {},
) {
  return {
    [ACTIVE_RIDE]: ok(rideFixture()),
    [QUICK_REPLIES_ROUTE]: ok(quickRepliesFixture()),
    [CHAT_THREAD]: ok(threadFixture({ unreadCount: 1 })),
    [CHAT_MESSAGES]: ok(messagePage([RIDER_MSG])),
    // The read-marker REST fallback (used while the socket is down).
    [CHAT_READ]: { status: 204 } as MockResponse,
    ...overrides,
  };
}

/** Renders the app with an active ride + chat, goes live, opens the chat. */
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
  await waitFor(() => expect(screen.getByTestId("chat-screen")).toBeTruthy());
  await waitFor(() =>
    expect(
      screen.getByTestId(`chat-message-${RIDER_MSG.messageId}`),
    ).toBeTruthy(),
  );
  return { contract, socket };
}

describe("driver chat (UC-S-13/14)", () => {
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

  it("opens from the ride sheet: header, history, read marker sent", async () => {
    const { socket } = await openChat();

    // Header: rider first name, pickup context, call button (phone non-null).
    expect(screen.getByTestId("chat-title")).toHaveTextContent("Rana");
    expect(screen.getByTestId("chat-context")).toHaveTextContent(
      "Pickup · Mazzeh Autostrad",
    );
    expect(screen.getByTestId("chat-call")).toBeTruthy();

    // The rider's message from history is on screen.
    expect(
      screen.getByTestId(`chat-bubble-text-${RIDER_MSG.messageId}`),
    ).toHaveTextContent("I'm at the pharmacy entrance");

    // Opening the thread marked it read on the socket (UC-S-14).
    await waitFor(() => {
      const reads = socket.framesOfType("chat.read");
      expect(reads.length).toBeGreaterThanOrEqual(1);
      expect(reads[0]).toMatchObject({
        rideId: RIDE_ID,
        lastReadMessageId: RIDER_MSG.messageId,
      });
    });
  });

  it("sends a quick reply with ONE tap — immediately, localized (NFR-U2)", async () => {
    const { socket } = await openChat();

    const button = screen.getByTestId("quick-reply-on_my_way");
    expect(button).toHaveTextContent("On my way");
    fireEvent.press(button);

    // The single tap already sent the frame — no confirm step.
    const sends = socket.framesOfType("chat.send");
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      rideId: RIDE_ID,
      kind: "quick_reply",
      quickReplyCode: "on_my_way",
    });
    expect(typeof sends[0].clientMsgId).toBe("string");

    // Optimistic pending bubble, then the echo (delivery ack) replaces it —
    // exactly one bubble, never a duplicate.
    expect(
      screen.getByTestId(`chat-message-pending:${sends[0].clientMsgId}`),
    ).toBeTruthy();
    receive(socket, {
      type: "chat.message",
      rideId: RIDE_ID,
      messageId: "aa000000-0000-4000-8000-000000000002",
      clientMsgId: sends[0].clientMsgId,
      senderRole: "driver",
      kind: "quick_reply",
      quickReplyCode: "on_my_way",
      sentAt: new Date().toISOString(),
    });
    await waitFor(() =>
      expect(
        screen.getByTestId(
          "chat-bubble-text-aa000000-0000-4000-8000-000000000002",
        ),
      ).toHaveTextContent("On my way"),
    );
    expect(
      screen.queryByTestId(`chat-message-pending:${sends[0].clientMsgId}`),
    ).toBeNull();
  });

  it("sends typed text and renders the rider's incoming frame", async () => {
    const { socket } = await openChat();

    fireEvent.changeText(screen.getByTestId("chat-input"), "  5 minutes  ");
    fireEvent.press(screen.getByTestId("chat-send"));

    const sends = socket.framesOfType("chat.send");
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      rideId: RIDE_ID,
      kind: "text",
      body: "5 minutes",
    });

    // Incoming rider message lands in the thread and is read on screen.
    receive(socket, chatMessageFrame({ body: "Blue jacket" }));
    await waitFor(() => expect(screen.getByText("Blue jacket")).toBeTruthy());
    await waitFor(() => {
      const reads = socket.framesOfType("chat.read");
      expect(reads[reads.length - 1]).toMatchObject({
        lastReadMessageId: "aa000000-0000-4000-8000-000000000009",
      });
    });
  });

  it("renders a live rider quick reply from the frame's texts (not in the driver catalog)", async () => {
    const { socket } = await openChat();
    receive(
      socket,
      chatMessageFrame({
        kind: "quick_reply",
        body: null,
        quickReplyCode: "rider_wait_please",
        quickReply: {
          code: "rider_wait_please",
          textEn: "One minute, please",
          textAr: "دقيقة من فضلك",
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("One minute, please")).toBeTruthy(),
    );
    expect(screen.queryByText("rider_wait_please")).toBeNull();
  });

  it("resends with the SAME clientMsgId after a reconnect and backfills (dedup)", async () => {
    const { contract, socket } = await openChat({
      [`${CHAT_MESSAGES}?after=${RIDER_MSG.messageId}`]: ok(messagePage([])),
    });

    fireEvent.changeText(screen.getByTestId("chat-input"), "On the bridge");
    fireEvent.press(screen.getByTestId("chat-send"));
    const first = socket.framesOfType("chat.send");
    expect(first).toHaveLength(1);

    // The socket drops before the echo: the send stays pending.
    act(() => socket.serverClose(1006));
    await waitFor(
      () => expect(MockSocket.instances.length).toBeGreaterThanOrEqual(2),
      { timeout: 5000 },
    );
    const next = MockSocket.latest();
    act(() => next.open());
    act(() => next.ready());

    // Reconnect: backfill newer-than-newest, then the pending send again —
    // same clientMsgId, so the server's dedup can answer the stored row.
    await waitFor(() => {
      expect(
        contract.requestsTo(`${CHAT_MESSAGES}?after=${RIDER_MSG.messageId}`)
          .length,
      ).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      const resent = next.framesOfType("chat.send");
      expect(resent).toHaveLength(1);
      expect(resent[0].clientMsgId).toBe(first[0].clientMsgId);
    });

    // The echo arrives once — one bubble, no duplicate.
    receive(next, {
      type: "chat.message",
      rideId: RIDE_ID,
      messageId: "aa000000-0000-4000-8000-000000000003",
      clientMsgId: first[0].clientMsgId,
      senderRole: "driver",
      kind: "text",
      body: "On the bridge",
      sentAt: new Date().toISOString(),
    });
    await waitFor(() =>
      expect(screen.getAllByText("On the bridge")).toHaveLength(1),
    );
  });

  it("read_only window: history only, composer and call hidden, notice shown", async () => {
    await renderDriverApp(
      chatRoutes({
        [ACTIVE_RIDE]: { status: 204 },
        [CHAT_THREAD]: ok(
          threadFixture({
            windowState: "read_only",
            closedAt: "2026-10-14T08:00:00Z",
            counterpart: {
              role: "rider",
              firstName: "Rana",
              photoUrl: null,
              phone: null,
            },
          }),
        ),
      }),
      { chat: true, initialUrl: `/chat?rideId=${RIDE_ID}` },
    );

    await waitFor(() =>
      expect(screen.getByTestId("chat-read-only")).toBeTruthy(),
    );
    expect(
      screen.getByTestId(`chat-bubble-text-${RIDER_MSG.messageId}`),
    ).toBeTruthy();
    expect(screen.queryByTestId("chat-input")).toBeNull();
    expect(screen.queryByTestId("chat-send")).toBeNull();
    expect(screen.queryByTestId("chat-quick-replies")).toBeNull();
    expect(screen.queryByTestId("chat-call")).toBeNull();
  });

  it("no thread (404): the none state, and no chat entry point on the ride", async () => {
    const contract = await renderDriverApp(
      chatRoutes({
        [CHAT_THREAD]: NOT_FOUND,
        [CHAT_MESSAGES]: NOT_FOUND,
      }),
      { chat: true },
    );
    await goLive();
    await waitForResync(contract);

    await waitFor(() =>
      expect(screen.getByTestId("to-pickup-sheet")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(contract.requestsTo(CHAT_THREAD).length).toBeGreaterThanOrEqual(1),
    );
    // No thread → no Chat button (UC-S-13: no entry point) — Share stays.
    expect(screen.queryByTestId("safety-chat")).toBeNull();
    expect(screen.getByTestId("safety-share")).toBeTruthy();
  });

  it("renders the Arabic catalog text on quick replies (owner i18n rules)", async () => {
    await setAppLanguage("ar");
    await openChat({}, { language: "ar" });
    expect(screen.getByTestId("quick-reply-on_my_way")).toHaveTextContent(
      "أنا في الطريق",
    );
    expect(screen.getByTestId("chat-context")).toHaveTextContent(
      /نقطة الانطلاق/,
    );
  });

  it("maps the chat push deep link (screen catalog)", () => {
    expect(
      hrefForLink(
        { screen: "chat", params: { rideId: RIDE_ID } },
        { isDriver: true },
      ),
    ).toEqual({ pathname: "/chat", params: { rideId: RIDE_ID } });
    expect(
      hrefForLink(
        { screen: "chat", params: { rideId: RIDE_ID } },
        { isDriver: false },
      ),
    ).toBe(NOTIFICATIONS_HREF);
    expect(hrefForLink({ screen: "chat" }, { isDriver: true })).toBe(
      NOTIFICATIONS_HREF,
    );
  });
});
