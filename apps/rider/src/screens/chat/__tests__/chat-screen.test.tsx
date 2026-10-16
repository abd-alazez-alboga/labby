/**
 * M10-T3 in-ride chat (UC-S-13/14, CHAT-01/02) against contract-shaped
 * mocks (comms-v1.yaml) and the fake realtime socket: thread header + call
 * gating, history rendering, localized quick replies (EN + AR), text send
 * with clientMsgId dedup (echo = ack), reconnect resend + `after` backfill,
 * read markers both ways ("Seen"), the read_only window and the 404
 * no-thread state; plus the M10 review paths: the reopened window, the
 * `invalid_message` / `chat_not_open` errors, load-earlier, the empty-
 * history and 404 → ready reconnects, in-flight merge and the pending
 * quick-reply bubble.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import { Linking, ScrollView } from "react-native";

import { resetQuickRepliesCache } from "../../../api/comms";
import { ChatProvider } from "../../../chat/chat-context";
import { openChatRideId } from "../../../chat/open-chat";
import { getAppConfig } from "../../../config/app-config";
import {
  LANGUAGE_STORAGE_KEY,
  LocaleProvider,
} from "../../../i18n/locale-context";
import { RideProvider } from "../../../ride/ride-context";
import {
  chatMessage,
  chatThread,
  messagePage,
  MSG_1,
  MSG_2,
  MSG_3,
  quickReplies,
} from "../../../test-utils/comms-fixtures";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  acceptedRide,
  FakeSocket,
  fakeSocketFactory,
  RIDE_ID,
} from "../../../test-utils/ride-fixtures";
import ChatScreen from "../chat-screen";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  // Focus = mounted in these screen-level tests.
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest
      .requireActual<typeof import("react")>("react")
      .useEffect(effect, [effect]),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const ACTIVE = "GET /api/v1/rides/active";
const THREAD = `GET /api/v1/rides/${RIDE_ID}/chat`;
const MESSAGES = `GET /api/v1/rides/${RIDE_ID}/chat/messages`;
const READ = `POST /api/v1/rides/${RIDE_ID}/chat/read`;
const QUICK = "GET /api/v1/chat/quick-replies";

function renderChat() {
  return render(
    <LocaleProvider>
      <RideProvider socketFactory={fakeSocketFactory}>
        <ChatProvider>
          <ChatScreen rideId={RIDE_ID} />
        </ChatProvider>
      </RideProvider>
    </LocaleProvider>,
  );
}

async function connect(): Promise<FakeSocket> {
  await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeSocket.latest();
  await act(async () => socket.open());
  await waitFor(() =>
    expect(socket.sent[0]).toEqual({ type: "auth", token: "seed-access" }),
  );
  await act(async () => socket.receive({ type: "ready", userId: "u-1" }));
  return socket;
}

/** The chat.send frames the client sent (auth/ping/read filtered out). */
function sentChatSends(socket: FakeSocket) {
  return socket.sent.filter((frame) => frame.type === "chat.send");
}

const history = [
  chatMessage({ messageId: MSG_1, body: "On my way" }),
  chatMessage({
    messageId: MSG_2,
    senderRole: "rider",
    body: "I'm at the pharmacy entrance, blue jacket",
    sentAt: "2026-10-13T09:31:00Z",
  }),
];

const baseRoutes = {
  [ACTIVE]: { status: 200, body: acceptedRide() },
  [THREAD]: { status: 200, body: chatThread() },
  [MESSAGES]: { status: 200, body: messagePage(history) },
  [READ]: { status: 204 },
  [QUICK]: { status: 200, body: quickReplies },
};

describe("chat screen (UC-S-13/14)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    FakeSocket.reset();
    secureStoreMock.__reset();
    resetQuickRepliesCache();
    await AsyncStorage.clear();
    await seedSignedInSession();
  });

  it("renders the thread: header with call, both bubble sides, quick replies", async () => {
    mockApi(baseRoutes);
    await renderChat();

    expect(await screen.findByTestId("chat-name")).toHaveTextContent("Samer");
    // Vehicle + state from the active ride (header subtitle).
    expect(screen.getByTestId("chat-subtitle")).toHaveTextContent(
      "Silver Hyundai Accent · On the way",
    );
    expect(screen.getByText("On my way")).toBeOnTheScreen();
    expect(
      screen.getByText("I'm at the pharmacy entrance, blue jacket"),
    ).toBeOnTheScreen();
    // Localized quick replies (EN), rendered from the catalog.
    for (const label of [
      "I'm coming",
      "Where are you now?",
      "One minute, please",
    ]) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    // Call button present while counterpart.phone is non-null.
    const spy = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await fireEvent.press(screen.getByTestId("chat-call"));
    expect(spy).toHaveBeenCalledWith("tel:+963955000111");
  });

  it("says a shared ride's thread is private to the member and driver (M12)", async () => {
    mockApi({
      ...baseRoutes,
      [ACTIVE]: { status: 200, body: acceptedRide({ kind: "shared" }) },
    });
    await renderChat();
    expect(await screen.findByTestId("chat-shared-private")).toHaveTextContent(
      /Private — only you and Samer see this chat\. Other riders can.t\./,
    );
  });

  it("shows no privacy note on a one-rider ride", async () => {
    mockApi(baseRoutes);
    await renderChat();
    expect(await screen.findByTestId("chat-name")).toBeOnTheScreen();
    expect(screen.queryByTestId("chat-shared-private")).toBeNull();
  });

  it("shows the driver photo as the header avatar, resolving an API-relative url", async () => {
    mockApi({
      ...baseRoutes,
      [THREAD]: {
        status: 200,
        body: chatThread({
          counterpart: {
            ...chatThread().counterpart,
            photoUrl: "/api/v1/files/tok-1",
          },
        }),
      },
    });
    await renderChat();

    const photo = await screen.findByTestId("chat-avatar-photo");
    expect(photo.props.source).toEqual({
      uri: `${getAppConfig().apiBaseUrl}/api/v1/files/tok-1`,
    });
    expect(photo).toHaveStyle({ width: 44, height: 44, borderRadius: 22 });
    expect(screen.queryByTestId("chat-avatar-initial")).toBeNull();

    // A photo that fails to load falls back to the initial.
    await act(async () => photo.props.onError());
    expect(screen.getByTestId("chat-avatar-initial")).toHaveTextContent("S");
  });

  it("keeps an absolute photo url as is", async () => {
    mockApi({
      ...baseRoutes,
      [THREAD]: {
        status: 200,
        body: chatThread({
          counterpart: {
            ...chatThread().counterpart,
            photoUrl: "https://cdn.example/p.jpg",
          },
        }),
      },
    });
    await renderChat();
    expect(
      (await screen.findByTestId("chat-avatar-photo")).props.source,
    ).toEqual({ uri: "https://cdn.example/p.jpg" });
  });

  it("falls back to the first-name initial on the accent tint without a photo", async () => {
    mockApi(baseRoutes);
    await renderChat();
    const initial = await screen.findByTestId("chat-avatar-initial");
    expect(initial).toHaveTextContent("S");
    expect(initial).toHaveStyle({
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: "#F1EAF8",
    });
    expect(screen.getByText("S")).toHaveStyle({ color: "#59128A" });
    expect(screen.queryByTestId("chat-avatar-photo")).toBeNull();
  });

  it("marks this ride's chat as open while it is on screen (push banner suppression)", async () => {
    mockApi(baseRoutes);
    const view = await renderChat();
    await screen.findByTestId("chat-name");
    expect(openChatRideId()).toBe(RIDE_ID);

    await view.unmount();
    expect(openChatRideId()).toBeNull();
  });

  it("renders Arabic quick replies and the AR placeholder", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi(baseRoutes);
    await renderChat();

    expect(await screen.findByText("أنا قادم")).toBeOnTheScreen();
    expect(screen.getByText("أين وصلت؟")).toBeOnTheScreen();
    expect(screen.getByTestId("chat-input").props.placeholder).toBe(
      "راسل Samer…",
    );
  });

  it("sends text with a clientMsgId and dedups the echo (delivery ack)", async () => {
    mockApi(baseRoutes);
    await renderChat();
    await screen.findByTestId("chat-name");
    const socket = await connect();

    await fireEvent.changeText(
      screen.getByTestId("chat-input"),
      "Okay, waiting",
    );
    await fireEvent.press(screen.getByTestId("chat-send"));

    const sends = sentChatSends(socket);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      type: "chat.send",
      rideId: RIDE_ID,
      kind: "text",
      body: "Okay, waiting",
    });
    const clientMsgId = sends[0].clientMsgId as string;
    expect(clientMsgId).toMatch(/^[0-9a-f-]{36}$/);
    // Pending until the echo arrives.
    expect(screen.getByTestId("chat-pending")).toBeOnTheScreen();

    await act(async () =>
      socket.receive({
        type: "chat.message",
        rideId: RIDE_ID,
        messageId: MSG_3,
        clientMsgId,
        senderRole: "rider",
        kind: "text",
        body: "Okay, waiting",
        sentAt: "2026-10-13T09:32:00Z",
      }),
    );
    // Echoed once: the pending bubble is replaced, never duplicated.
    expect(screen.queryByTestId("chat-pending")).toBeNull();
    expect(screen.getAllByText("Okay, waiting")).toHaveLength(1);
  });

  it("resends the unacked message after a reconnect with the SAME clientMsgId and backfills with `after`", async () => {
    const api = mockApi(baseRoutes);
    await renderChat();
    await screen.findByTestId("chat-name");
    const socket = await connect();

    await fireEvent.changeText(screen.getByTestId("chat-input"), "Still here");
    await fireEvent.press(screen.getByTestId("chat-send"));
    const first = sentChatSends(socket)[0];
    // Every ready backfills (the first connect included): count from here.
    const backfills = () =>
      api
        .callsTo("GET", `/api/v1/rides/${RIDE_ID}/chat/messages`)
        .filter((call) => call.query.after);
    const before = backfills().length;

    // The socket dies before the echo; a new one connects.
    await act(async () => socket.serverClose(1001));
    // Reconnect backoff is 1 s ± 20 % jitter (protocol.ts).
    await waitFor(
      () => expect(FakeSocket.instances.length).toBeGreaterThan(1),
      { timeout: 3000 },
    );
    const next = FakeSocket.latest();
    await act(async () => next.open());
    await waitFor(() => expect(next.sent.length).toBeGreaterThan(0));
    await act(async () => next.receive({ type: "ready", userId: "u-1" }));

    // Resent with the identical clientMsgId (server dedups on it).
    await waitFor(() => expect(sentChatSends(next)).toHaveLength(1));
    expect(sentChatSends(next)[0].clientMsgId).toBe(first.clientMsgId);

    // Reconnect backfill: everything after the last shown message.
    await waitFor(() => expect(backfills()).toHaveLength(before + 1));
    expect(backfills().at(-1)?.query.after).toBe(MSG_2);
  });

  it("sends a quick reply as kind quick_reply with its code", async () => {
    mockApi(baseRoutes);
    await renderChat();
    await screen.findByTestId("chat-name");
    const socket = await connect();

    await fireEvent.press(screen.getByTestId("chat-quick-reply-rider_coming"));
    const sends = sentChatSends(socket);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      kind: "quick_reply",
      quickReplyCode: "rider_coming",
    });
    expect(sends[0].body).toBeUndefined();
  });

  it("marks incoming counterpart messages read and shows Seen on the counterpart's read", async () => {
    const api = mockApi(baseRoutes);
    await renderChat();
    await screen.findByTestId("chat-name");
    // Opening the chat reads the shown history (REST fallback pre-socket).
    await waitFor(() =>
      expect(
        api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/chat/read`),
      ).toHaveLength(1),
    );
    expect(
      api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/chat/read`)[0].body,
    ).toEqual({ lastReadMessageId: MSG_1 });

    const socket = await connect();
    // A new driver message while open → chat.read frame on the socket.
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
    expect(screen.getByText("Stuck in traffic")).toBeOnTheScreen();
    await waitFor(() =>
      expect(
        socket.sent.filter((frame) => frame.type === "chat.read"),
      ).toHaveLength(1),
    );
    expect(socket.sent.find((frame) => frame.type === "chat.read")).toEqual({
      type: "chat.read",
      rideId: RIDE_ID,
      lastReadMessageId: MSG_3,
    });

    // The driver read my last message → "Seen" under it.
    expect(screen.queryByTestId("chat-seen")).toBeNull();
    await act(async () =>
      socket.receive({
        type: "chat.read",
        rideId: RIDE_ID,
        readerRole: "driver",
        lastReadMessageId: MSG_2,
      }),
    );
    expect(screen.getByTestId("chat-seen")).toHaveTextContent("Seen");
  });

  it("renders a live counterpart quick reply from the frame's texts (not in the rider catalog)", async () => {
    mockApi(baseRoutes);
    await renderChat();
    await screen.findByTestId("chat-name");
    const socket = await connect();
    await act(async () =>
      socket.receive({
        type: "chat.message",
        rideId: RIDE_ID,
        messageId: MSG_3,
        senderRole: "driver",
        kind: "quick_reply",
        quickReplyCode: "driver_cant_find",
        quickReply: {
          code: "driver_cant_find",
          textEn: "I can't find you",
          textAr: "لا أستطيع إيجادك",
        },
        sentAt: "2026-10-13T09:33:00Z",
      }),
    );
    expect(screen.getByText("I can't find you")).toBeOnTheScreen();
    expect(screen.queryByText("driver_cant_find")).toBeNull();
  });

  it("read_only window: history visible, composer + call replaced by a notice", async () => {
    mockApi({
      ...baseRoutes,
      [ACTIVE]: { status: 204 },
      [THREAD]: {
        status: 200,
        body: chatThread({
          windowState: "read_only",
          closedAt: "2026-10-14T10:00:00Z",
          counterpart: {
            role: "driver",
            firstName: "Samer",
            photoUrl: null,
            phone: null,
          },
        }),
      },
    });
    await renderChat();

    expect(await screen.findByTestId("chat-read-only")).toBeOnTheScreen();
    expect(screen.getByText("On my way")).toBeOnTheScreen();
    expect(screen.queryByTestId("chat-input")).toBeNull();
    expect(screen.queryByTestId("chat-send")).toBeNull();
    expect(screen.queryByTestId("chat-call")).toBeNull();
    expect(screen.queryByTestId("chat-quick-replies")).toBeNull();
  });

  it("404 thread: the no-chat state, no composer", async () => {
    mockApi({
      ...baseRoutes,
      [ACTIVE]: { status: 204 },
      [THREAD]: { status: 404, body: { status: 404, message: "No thread" } },
      [MESSAGES]: { status: 404, body: { status: 404, message: "No thread" } },
    });
    await renderChat();

    expect(await screen.findByTestId("chat-missing")).toBeOnTheScreen();
    expect(screen.getByText("No chat for this ride")).toBeOnTheScreen();
    expect(screen.queryByTestId("chat-input")).toBeNull();
  });

  it("a chat_closed error drops the queue and flips to the read-only notice", async () => {
    mockApi({
      ...baseRoutes,
      // Four `open` reads (provider + screen on mount, both again on the
      // socket ready), then the error-triggered re-read sees read_only.
      [THREAD]: [
        { status: 200, body: chatThread() },
        { status: 200, body: chatThread() },
        { status: 200, body: chatThread() },
        { status: 200, body: chatThread() },
        {
          status: 200,
          body: chatThread({
            windowState: "read_only",
            counterpart: {
              role: "driver",
              firstName: "Samer",
              photoUrl: null,
              phone: null,
            },
          }),
        },
      ],
    });
    await renderChat();
    await screen.findByTestId("chat-name");
    const socket = await connect();

    await fireEvent.changeText(screen.getByTestId("chat-input"), "Too late?");
    await fireEvent.press(screen.getByTestId("chat-send"));
    expect(screen.getByTestId("chat-pending")).toBeOnTheScreen();

    await act(async () =>
      socket.receive({
        type: "error",
        code: "chat_closed",
        message: "The chat window is closed",
      }),
    );
    expect(await screen.findByTestId("chat-read-only")).toBeOnTheScreen();
    expect(screen.queryByTestId("chat-pending")).toBeNull();
  });

  it("asks the catalog for the rider audience (`as=rider`, B-H2)", async () => {
    const api = mockApi(baseRoutes);
    await renderChat();
    await screen.findByText("I'm coming");
    const calls = api.callsTo("GET", "/api/v1/chat/quick-replies");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.query).toEqual({ as: "rider" });
  });

  it("a pending quick reply shows its localized text until the echo", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi(baseRoutes);
    await renderChat();
    await screen.findByText("أنا قادم");
    await connect();

    await fireEvent.press(screen.getByTestId("chat-quick-reply-rider_coming"));
    expect(screen.getByTestId("chat-pending")).toHaveTextContent(/أنا قادم/);
  });

  it("quick-reply chips meet the 48 px touch target", async () => {
    mockApi(baseRoutes);
    await renderChat();
    expect(
      await screen.findByTestId("chat-quick-reply-rider_coming"),
    ).toHaveStyle({ height: 48 });
  });

  it("reopened window (UC-S-13 A2): writable, call shown", async () => {
    mockApi({
      ...baseRoutes,
      [ACTIVE]: { status: 204 },
      [THREAD]: { status: 200, body: chatThread({ windowState: "reopened" }) },
    });
    await renderChat();

    expect(await screen.findByTestId("chat-input")).toBeOnTheScreen();
    expect(screen.getByTestId("chat-send")).toBeOnTheScreen();
    expect(screen.getByTestId("chat-call")).toBeOnTheScreen();
    expect(screen.getByTestId("chat-quick-replies")).toBeOnTheScreen();
    expect(screen.queryByTestId("chat-read-only")).toBeNull();
  });

  it("invalid_message: send-failed banner, only the refused (oldest in-flight) message is dropped", async () => {
    mockApi(baseRoutes);
    await renderChat();
    await screen.findByTestId("chat-name");
    const socket = await connect();

    await fireEvent.changeText(screen.getByTestId("chat-input"), "First");
    await fireEvent.press(screen.getByTestId("chat-send"));
    await fireEvent.changeText(screen.getByTestId("chat-input"), "Second");
    await fireEvent.press(screen.getByTestId("chat-send"));
    expect(screen.getAllByTestId("chat-pending")).toHaveLength(2);

    // The server answers frames in order: the error refers to "First".
    await act(async () =>
      socket.receive({
        type: "error",
        code: "invalid_message",
        message: "Invalid message",
      }),
    );
    expect(screen.getByTestId("chat-send-failed")).toHaveTextContent(
      "This message couldn't be sent.",
    );
    const left = screen.getAllByTestId("chat-pending");
    expect(left).toHaveLength(1);
    expect(left[0]).toHaveTextContent(/Second/);
  });

  it("a chat_not_open error drops the queue and re-reads the thread", async () => {
    const api = mockApi({
      ...baseRoutes,
      // Provider + screen on mount and again on ready, then the re-read.
      [THREAD]: [
        { status: 200, body: chatThread() },
        { status: 200, body: chatThread() },
        { status: 200, body: chatThread() },
        { status: 200, body: chatThread() },
        { status: 404, body: { status: 404, message: "No thread" } },
      ],
    });
    await renderChat();
    await screen.findByTestId("chat-name");
    const socket = await connect();
    await waitFor(() =>
      expect(api.callsTo("GET", `/api/v1/rides/${RIDE_ID}/chat`)).toHaveLength(4),
    );

    await fireEvent.changeText(screen.getByTestId("chat-input"), "Hello?");
    await fireEvent.press(screen.getByTestId("chat-send"));
    expect(screen.getByTestId("chat-pending")).toBeOnTheScreen();

    await act(async () =>
      socket.receive({
        type: "error",
        code: "chat_not_open",
        message: "The chat is not open",
      }),
    );
    expect(await screen.findByTestId("chat-missing")).toBeOnTheScreen();
    expect(screen.queryByTestId("chat-pending")).toBeNull();
  });

  it("load earlier: prepends the older page with `before` and does not jump to the bottom", async () => {
    const scrollToEnd = jest.spyOn(ScrollView.prototype, "scrollToEnd");
    const older = chatMessage({
      messageId: MSG_3,
      body: "I'm at the gate",
      sentAt: "2026-10-13T09:20:00Z",
    });
    const api = mockApi({
      ...baseRoutes,
      [MESSAGES]: [
        { status: 200, body: messagePage(history, "cursor-1") },
        { status: 200, body: messagePage([older]) },
      ],
    });
    try {
      await renderChat();
      await screen.findByText("On my way");
      // Initial load scrolls to the newest message.
      await waitFor(() => expect(scrollToEnd).toHaveBeenCalled());
      scrollToEnd.mockClear();

      await fireEvent.press(screen.getByTestId("chat-load-earlier"));
      expect(await screen.findByText("I'm at the gate")).toBeOnTheScreen();
      const call = api
        .callsTo("GET", `/api/v1/rides/${RIDE_ID}/chat/messages`)
        .at(-1);
      expect(call?.query.before).toBe("cursor-1");
      // Older first, then the shown history.
      const bubbles = screen.getAllByTestId(/chat-bubble-/);
      expect(bubbles).toHaveLength(3);
      expect(bubbles[0]).toHaveTextContent(/I'm at the gate/);
      expect(bubbles[1]).toHaveTextContent(/On my way/);
      expect(bubbles[2]).toHaveTextContent(/pharmacy entrance/);
      // Exhausted: the control is gone.
      expect(screen.queryByTestId("chat-load-earlier")).toBeNull();
      await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(scrollToEnd).not.toHaveBeenCalled();
    } finally {
      scrollToEnd.mockRestore();
    }
  });

  it("reconnect with an empty history reloads the latest page (no `after`) and shows the missed message", async () => {
    const missed = chatMessage({ messageId: MSG_3, body: "I'm here" });
    const api = mockApi({
      ...baseRoutes,
      [MESSAGES]: [
        { status: 200, body: messagePage([]) },
        { status: 200, body: messagePage([]) },
        { status: 200, body: messagePage([missed]) },
      ],
    });
    await renderChat();
    await screen.findByTestId("chat-name");
    const socket = await connect();
    const messageCalls = () =>
      api.callsTo("GET", `/api/v1/rides/${RIDE_ID}/chat/messages`);
    await waitFor(() => expect(messageCalls()).toHaveLength(2));
    expect(screen.queryByText("I'm here")).toBeNull();

    // The socket drops; the driver writes during the gap.
    await act(async () => socket.serverClose(1001));
    await waitFor(
      () => expect(FakeSocket.instances.length).toBeGreaterThan(1),
      { timeout: 3000 },
    );
    const next = FakeSocket.latest();
    await act(async () => next.open());
    await waitFor(() => expect(next.sent.length).toBeGreaterThan(0));
    await act(async () => next.receive({ type: "ready", userId: "u-1" }));

    expect(await screen.findByText("I'm here")).toBeOnTheScreen();
    expect(messageCalls().at(-1)?.query).toEqual({ size: "50" });
  });

  it("a thread that appears on reconnect (404 → ready) loads its history", async () => {
    mockApi({
      ...baseRoutes,
      // Provider + screen on mount: no thread yet; on ready it exists.
      [THREAD]: [
        { status: 404, body: { status: 404, message: "No thread" } },
        { status: 404, body: { status: 404, message: "No thread" } },
        { status: 200, body: chatThread() },
      ],
      [MESSAGES]: [
        { status: 404, body: { status: 404, message: "No thread" } },
        { status: 200, body: messagePage(history) },
      ],
    });
    await renderChat();
    expect(await screen.findByTestId("chat-missing")).toBeOnTheScreen();

    await connect();
    expect(await screen.findByText("On my way")).toBeOnTheScreen();
    expect(
      screen.getByText("I'm at the pharmacy entrance, blue jacket"),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("chat-input")).toBeOnTheScreen();
  });

  it("a live frame that lands while the history request is in flight survives the load", async () => {
    let resolvePage: (value: unknown) => void = () => {};
    const api = mockApi(baseRoutes);
    const realFetch = api.fetchMock.getMockImplementation() as (
      input: unknown,
      init?: RequestInit,
    ) => Promise<Response>;
    // Hold the first history read until the live frame has arrived.
    let held = false;
    api.fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (!held && url.includes(`/rides/${RIDE_ID}/chat/messages`)) {
        held = true;
        await new Promise((resolve) => {
          resolvePage = resolve;
        });
      }
      return realFetch(input, init);
    });
    await renderChat();
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
    await act(async () => resolvePage(undefined));

    expect(await screen.findByText("On my way")).toBeOnTheScreen();
    expect(screen.getByText("Stuck in traffic")).toBeOnTheScreen();
  });
});
