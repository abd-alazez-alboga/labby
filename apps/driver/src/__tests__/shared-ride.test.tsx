/**
 * M12-T4 — UC-D-13 against scheduled-shared-v1.yaml mocks: the shared offer
 * labelled with seats and parties, the to-pickup chip, the member list at
 * pickup (Absent locked until the wait grace, confirm sheet, per-member
 * no-show, 409 wait_grace_running), no whole-ride no-show reason, the
 * per-member chat list (one private thread per member — ruling
 * 2026-10-16), the per-member collection (split summary, cash-confirm /
 * mark-unpaid per member, wallet paid, absent fee) closing the ride once
 * every member is settled, and Arabic RTL.
 */
import { fireEvent, waitFor } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
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
import { arrivedRide, offerFixture, offerNewFrame, RIDE_ID } from "../test-utils/rides";
import type { MockResponse } from "../test-utils/contract";
import {
  chatMessageFixture,
  chatMessageFrame,
  messagePage,
  QUICK_REPLIES_ROUTE,
  quickRepliesFixture,
  threadFixture,
} from "../test-utils/comms";
import {
  coded,
  completedShared,
  LINA,
  memberRoute,
  OMAR,
  ok,
  RANA,
  sharedRide,
  withSplit,
} from "../test-utils/scheduled";

const originalWebSocket = globalThis.WebSocket;

async function withActiveRide(
  ride: unknown,
  routes: Record<string, MockResponse | MockResponse[]> = {},
  language: "en" | "ar" = "en",
) {
  const contract = await renderDriverApp(
    { [ACTIVE_RIDE]: ok(ride), ...routes },
    { language },
  );
  const socket = await goLive();
  await waitForResync(contract);
  return { contract, socket };
}

/** A shared ride at pickup; the free wait ends `graceLeftMs` from now. */
function sharedAtPickup(graceLeftMs: number, members = [RANA, OMAR, LINA]) {
  const arrived = arrivedRide(graceLeftMs, 120000);
  return sharedRide(
    {
      state: "driver_arrived",
      timeline: arrived.timeline,
      waitGraceEndsAt: arrived.waitGraceEndsAt,
    },
    members,
  );
}

describe("shared ride (UC-D-13)", () => {
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

  it("a shared offer is labelled with its seats and parties", async () => {
    const contract = await renderDriverApp();
    const socket = await goLive();
    await waitForResync(contract);
    receive(socket, offerNewFrame(offerFixture({ shared: { seats: 4, parties: 3 } })));

    expect(await screen.findByTestId("offer-shared-seats")).toHaveTextContent(
      "4 seats · 3 parties",
    );
    expect(screen.getByTestId("offer-service")).toHaveTextContent("Shared · Economy");
    expect(screen.getByTestId("offer-fare-caption")).toHaveTextContent(
      "Estimated fare for the whole ride",
    );
  });

  it("to pickup: the shared chip, the per-member chat list, no report link", async () => {
    await withActiveRide(sharedRide());
    expect(await screen.findByTestId("to-pickup-title")).toHaveTextContent("Pick up the group");
    expect(screen.getByTestId("ride-kind-chip")).toHaveTextContent(
      "Shared · 4 seats · 3 parties",
    );
    expect(screen.queryByTestId("safety-report")).toBeNull();
    expect(screen.queryByTestId("safety-chat")).toBeNull();

    fireEvent.press(screen.getByTestId("safety-shared-chats"));
    expect(await screen.findByTestId("shared-chats-screen")).toBeTruthy();
    expect(screen.getByTestId(`shared-chat-${RANA.memberId}`)).toHaveTextContent(/Rana/);
    expect(screen.getByTestId(`shared-chat-${OMAR.memberId}`)).toHaveTextContent(/Omar/);
    expect(screen.getByTestId(`shared-chat-${LINA.memberId}`)).toHaveTextContent(/Lina/);
  });

  it("the chat list keeps an absent member's thread and shows each thread's unread count (review W13)", async () => {
    const absent = { ...LINA, status: "no_show" as const, cancellationFee: 2000 };
    await withActiveRide(sharedRide({}, [RANA, OMAR, absent]), {
      [`GET /api/v1/rides/${RIDE_ID}/chat?memberId=${RANA.memberId}`]: ok(
        threadFixture({ unreadCount: 2 }),
      ),
      [`GET /api/v1/rides/${RIDE_ID}/chat?memberId=${OMAR.memberId}`]: ok(
        threadFixture({ unreadCount: 0 }),
      ),
      [`GET /api/v1/rides/${RIDE_ID}/chat?memberId=${LINA.memberId}`]: ok(
        threadFixture({ unreadCount: 1 }),
      ),
    });
    fireEvent.press(await screen.findByTestId("safety-shared-chats"));
    expect(await screen.findByTestId(`shared-chat-${LINA.memberId}`)).toHaveTextContent(
      /Absent/,
    );
    expect(await screen.findByTestId(`shared-chat-unread-${RANA.memberId}`)).toHaveTextContent(
      "2",
    );
    expect(await screen.findByTestId(`shared-chat-unread-${LINA.memberId}`)).toHaveTextContent(
      "1",
    );
    expect(screen.queryByTestId(`shared-chat-unread-${OMAR.memberId}`)).toBeNull();
  });

  it("a member's chat opens that member's private thread (memberId) and shows only its messages", async () => {
    const thread = `/api/v1/rides/${RIDE_ID}/chat?memberId=${LINA.memberId}`;
    const messages = `/api/v1/rides/${RIDE_ID}/chat/messages?memberId=${LINA.memberId}`;
    const contract = await renderDriverApp(
      {
        [ACTIVE_RIDE]: ok(sharedRide()),
        [QUICK_REPLIES_ROUTE]: ok(quickRepliesFixture()),
        [`GET ${thread}`]: ok(
          threadFixture({ counterpart: { ...threadFixture().counterpart, firstName: "Lina" } }),
        ),
        [`GET ${messages}`]: ok(
          messagePage([chatMessageFixture({ body: "I'm by the kiosk" })]),
        ),
      },
      { chat: true },
    );
    const socket = await goLive();
    await waitForResync(contract);
    // A shared ride has no ride-level thread.
    expect(contract.requestsTo(`GET /api/v1/rides/${RIDE_ID}/chat`)).toHaveLength(0);

    fireEvent.press(await screen.findByTestId("safety-shared-chats"));
    fireEvent.press(await screen.findByTestId(`shared-chat-${LINA.memberId}`));
    expect(await screen.findByText("I'm by the kiosk")).toBeTruthy();
    expect(contract.requestsTo(`GET ${thread}`).length).toBeGreaterThanOrEqual(1);

    // Another member's message never lands in Lina's thread.
    receive(
      socket,
      chatMessageFrame({ memberId: RANA.memberId, body: "Rana here", messageId: "m-rana" }),
    );
    receive(
      socket,
      chatMessageFrame({ memberId: LINA.memberId, body: "Coming now", messageId: "m-lina" }),
    );
    expect(await screen.findByText("Coming now")).toBeTruthy();
    expect(screen.queryByText("Rana here")).toBeNull();
  });

  it("at pickup every party is listed; Absent stays locked during the free wait; no whole-ride no-show", async () => {
    await withActiveRide(sharedAtPickup(60000));
    expect(await screen.findByTestId("shared-pickup-sheet")).toBeTruthy();
    expect(screen.getByTestId(`member-${RANA.memberId}`)).toHaveTextContent(
      /Rana · created the ride.*Party of 2 · Cash/,
    );
    expect(screen.getByTestId(`member-${OMAR.memberId}`)).toHaveTextContent(
      /Omar.*Party of 1 · Wallet/,
    );
    const absent = screen.getByTestId(`member-absent-${LINA.memberId}`);
    expect(absent.props.accessibilityState.disabled).toBe(true);
    expect(absent).toHaveTextContent(/Absent in 0:5\d|Absent in 1:00/);
    expect(screen.getByTestId("free-wait-text")).toHaveTextContent(/Free wait ends in/);

    fireEvent.press(screen.getByTestId("ride-cancel-open"));
    expect(await screen.findByTestId("cancel-sheet")).toBeTruthy();
    expect(screen.queryByTestId("cancel-reason-rider_no_show")).toBeNull();
    expect(screen.getByTestId("cancel-reason-vehicle_issue")).toBeTruthy();
  });

  it("after the free wait a party is marked absent (confirm sheet → per-member no-show)", async () => {
    const after = sharedAtPickup(-1000, [RANA, OMAR, { ...LINA, status: "no_show", cancellationFee: 2000 }]);
    const { contract } = await withActiveRide(sharedAtPickup(-1000), {
      [memberRoute(RIDE_ID, LINA.memberId, "no-show")]: ok(after),
    });
    expect(await screen.findByTestId("free-wait-text")).toHaveTextContent(
      "Free wait is over — you can mark who didn't come as absent.",
    );
    fireEvent.press(screen.getByTestId(`member-absent-${LINA.memberId}`));
    expect(await screen.findByTestId("member-no-show-title")).toHaveTextContent(
      "Mark Lina absent?",
    );
    expect(screen.getByTestId("member-no-show-sheet")).toHaveTextContent(
      /pays the cancellation fee and no share of the fare/,
    );
    fireEvent.press(screen.getByTestId("member-no-show-confirm"));

    expect(await screen.findByTestId(`member-status-${LINA.memberId}`)).toHaveTextContent("Absent");
    expect(screen.queryByTestId("member-no-show-sheet")).toBeNull();
    expect(contract.requestsTo(memberRoute(RIDE_ID, LINA.memberId, "no-show"))).toHaveLength(1);
    // The others still ride.
    expect(screen.getByTestId(`member-absent-${RANA.memberId}`)).toBeTruthy();
  });

  it("a no-show the server finds too early (409 wait_grace_running) is explained", async () => {
    const graceEnds = new Date(Date.now() + 30000).toISOString();
    await withActiveRide(sharedAtPickup(-1000), {
      [memberRoute(RIDE_ID, OMAR.memberId, "no-show")]: coded(409, "wait_grace_running", {
        waitGraceEndsAt: graceEnds,
      }),
    });
    fireEvent.press(await screen.findByTestId(`member-absent-${OMAR.memberId}`));
    fireEvent.press(await screen.findByTestId("member-no-show-confirm"));
    expect(await screen.findByTestId("member-no-show-too-early")).toBeTruthy();
    expect(screen.getByTestId("member-no-show-sheet")).toBeTruthy();
  });

  it("completion: the split, then each party settles on its own; the ride closes when all are settled", async () => {
    const completed = withSplit(completedShared());
    const settled = withSplit(
      completedShared({
        shared: {
          ...completed.shared!,
          members: completed.shared!.members.map((m) =>
            m.memberId === RANA.memberId ? { ...m, paymentStatus: "paid_cash" as const } : m,
          ),
        },
      }),
    );
    const { contract } = await withActiveRide(completed, {
      [memberRoute(RIDE_ID, RANA.memberId, "cash-confirm")]: ok(settled),
    });

    expect(await screen.findByTestId("shared-collect-screen")).toBeTruthy();
    expect(screen.getByTestId("split-card")).toHaveTextContent(
      /Fare SYP 28,500 ÷ 3 boarded seats/,
    );
    expect(screen.getByTestId("split-per-seat")).toHaveTextContent("SYP 9,500 per seat");
    expect(screen.getByTestId(`collect-amount-${RANA.memberId}`)).toHaveTextContent("SYP 19,000");
    expect(screen.getByTestId(`collect-status-${OMAR.memberId}`)).toHaveTextContent("Paid");
    expect(screen.queryByTestId(`collect-cash-${OMAR.memberId}`)).toBeNull();
    expect(screen.getByTestId(`collect-${LINA.memberId}`)).toHaveTextContent(
      /Owes the cancellation fee.*SYP 2,000/,
    );

    fireEvent.press(screen.getByTestId(`collect-cash-${RANA.memberId}`));
    expect(await screen.findByTestId("ride-notice-sharedSettled")).toBeTruthy();
    expect(screen.queryByTestId("shared-collect-screen")).toBeNull();
    expect(contract.requestsTo(memberRoute(RIDE_ID, RANA.memberId, "cash-confirm"))).toHaveLength(1);
  });

  it("a member who didn't pay is marked unpaid on their own; others stay pending", async () => {
    const twoCash = withSplit(
      completedShared({}),
    );
    const members = [
      twoCash.shared!.members[0],
      { ...OMAR, status: "completed" as const, paymentMethod: "cash" as const, shareAmount: 9500, cashDue: 9500, paymentStatus: "pending" as const },
      twoCash.shared!.members[2],
    ];
    const start = { ...twoCash, shared: { ...twoCash.shared!, members } };
    const after = {
      ...start,
      shared: {
        ...start.shared,
        members: members.map((m) =>
          m.memberId === OMAR.memberId ? { ...m, paymentStatus: "unpaid" as const } : m,
        ),
      },
    };
    await withActiveRide(start, {
      [memberRoute(RIDE_ID, OMAR.memberId, "mark-unpaid")]: ok(after),
    });
    fireEvent.press(await screen.findByTestId(`collect-unpaid-${OMAR.memberId}`));
    expect(await screen.findByTestId(`collect-status-${OMAR.memberId}`)).toHaveTextContent("Unpaid");
    expect(screen.getByTestId(`collect-cash-${RANA.memberId}`)).toBeTruthy();
    expect(screen.getByTestId("collect-hint")).toHaveTextContent(/\(1 left\)/);
  });

  it("Arabic: the collection reads right to left with Western digits", async () => {
    await setAppLanguage("ar");
    await withActiveRide(withSplit(completedShared()), {}, "ar");
    expect(await screen.findByTestId("shared-collect-title")).toHaveTextContent(
      "اكتملت الرحلة · رحلة مشتركة",
    );
    await waitFor(() =>
      expect(screen.getByTestId("split-per-seat")).toHaveTextContent(/9,500/),
    );
    expect(screen.getByTestId(`collect-cash-${RANA.memberId}`)).toHaveTextContent("استلمت النقود");
  });
});
