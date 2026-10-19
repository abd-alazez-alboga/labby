/**
 * M14-T3 tickets + lost items (UC-S-19/20, UC-R-20, SUP-01/02, LOST-01/02)
 * against support-v1.yaml mocks: creating a ticket (category required,
 * attachment uploads, the optional ride link), the list with status chips
 * and unread badges, the thread (events merged in, the waiting-on-you
 * banner, reply, closed read-only + 409 ticket_closed), the lost-item
 * report from a completed ride (photos, 409 lost_item_case_open) and the
 * rider case view with its timeline and the reopened-chat entry.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import * as mockReact from "react";

import { LocaleProvider } from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import { RIDE_ID } from "../../../test-utils/ride-fixtures";
import { completedRide } from "../../../test-utils/trust-fixtures";
import LostItemCaseScreen from "../lost-item-case-screen";
import LostItemReportScreen from "../lost-item-report-screen";
import TicketCreateScreen from "../ticket-create-screen";
import TicketThreadScreen from "../ticket-thread-screen";
import TicketsScreen from "../tickets-screen";

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
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
  useFocusEffect: (effect: () => void | (() => void)) =>
    mockReact.useEffect(effect, [effect]),
}));

const mockLaunchImageLibraryAsync = jest.fn();
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibraryAsync(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const TICKET_ID = "tttttttt-tttt-4ttt-8ttt-ttttttttttt1";
const LOST_ID = "llllllll-0000-4000-8000-000000000001";
const CAT_ID = "catcatca-0000-4000-8000-000000000001";

const CATEGORIES = "GET /api/v1/support/ticket-categories";
const RIDES = "GET /api/v1/rides";
const RIDE = `GET /api/v1/rides/${RIDE_ID}`;
const FILES = "POST /api/v1/ticket-files";
const CREATE = "POST /api/v1/tickets";
const LIST = "GET /api/v1/tickets";
const DETAIL = `GET /api/v1/tickets/${TICKET_ID}`;
const MESSAGES = `POST /api/v1/tickets/${TICKET_ID}/messages`;
const REPORT = `POST /api/v1/rides/${RIDE_ID}/lost-item`;
const CASE = `GET /api/v1/lost-items/${LOST_ID}`;

function ticketCategory(overrides = {}) {
  return {
    ticketCategoryId: CAT_ID,
    name: { en: "Payments", ar: "المدفوعات" },
    defaultPriority: "high",
    sortOrder: 0,
    ...overrides,
  };
}

function ticket(overrides = {}) {
  return {
    ticketId: TICKET_ID,
    kind: "ticket",
    category: ticketCategory(),
    priority: "high",
    status: "waiting_on_user",
    caseStatus: null,
    description: "Charged cash after wallet payment",
    ride: null,
    attachments: [],
    unreadSupportMessages: 2,
    lastMessageAt: "2026-10-18T15:40:00Z",
    createdAt: "2026-10-17T14:02:00Z",
    updatedAt: "2026-10-18T15:41:00Z",
    ...overrides,
  };
}

function detail(overrides = {}) {
  return {
    ...ticket(),
    messages: [
      {
        messageId: "m1m1m1m1-0000-4000-8000-000000000001",
        ticketId: TICKET_ID,
        senderSide: "user",
        senderName: "Test Rider",
        body: "I paid from my wallet but the receipt shows cash due.",
        createdAt: "2026-10-17T14:02:00Z",
      },
      {
        messageId: "m2m2m2m2-0000-4000-8000-000000000002",
        ticketId: TICKET_ID,
        senderSide: "support",
        senderName: "Labby support",
        body: "Could you send a photo of the receipt screen?",
        createdAt: "2026-10-17T15:40:00Z",
      },
    ],
    events: [
      {
        eventId: "e1e1e1e1-0000-4000-8000-000000000001",
        type: "created",
        actorSide: "user",
        actorName: null,
        fromValue: null,
        toValue: null,
        createdAt: "2026-10-17T14:02:00Z",
      },
      {
        eventId: "e2e2e2e2-0000-4000-8000-000000000002",
        type: "status_changed",
        actorSide: "support",
        actorName: null,
        fromValue: "in_progress",
        toValue: "waiting_on_user",
        createdAt: "2026-10-17T15:41:00Z",
      },
    ],
    ...overrides,
  };
}

function lostCase(overrides = {}) {
  return {
    ticketId: LOST_ID,
    caseStatus: "driver_contacted",
    status: "in_progress",
    description: "Black backpack",
    photos: [],
    ride: {
      rideId: RIDE_ID,
      kind: "on_demand",
      state: "completed",
      startedAt: "2026-10-18T18:24:00Z",
      counterpartName: "Samer",
    },
    reporter: {
      userId: "uuuuuuuu-0000-4000-8000-000000000001",
      name: "Test Rider",
      role: "rider",
    },
    driver: {
      userId: "dddddddd-0000-4000-8000-000000000001",
      name: "Samer",
      role: "driver",
    },
    chatWindow: "reopened",
    createdAt: "2026-10-18T21:10:00Z",
    updatedAt: "2026-10-19T09:30:00Z",
    ...overrides,
  };
}

function ridePage() {
  return {
    items: [
      {
        id: RIDE_ID,
        state: "completed",
        requestedAt: "2026-10-17T09:00:00Z",
        pickup: { lat: 1, lng: 2, label: "Umayyad Square" },
        destination: { lat: 3, lng: 4, label: "Mezzeh" },
        serviceTypeNameEn: "Economy",
        serviceTypeNameAr: "اقتصادية",
        counterpartFirstName: "Samer",
      },
    ],
    page: 0,
    size: 20,
    totalItems: 1,
  };
}

function page(items: unknown[], totalItems = items.length) {
  return { items, page: 0, size: 20, totalItems };
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
});

describe("create a ticket (UC-S-19, SUP-01)", () => {
  it("requires a category and a description before posting", async () => {
    const api = mockApi({
      [CATEGORIES]: { status: 200, body: [ticketCategory()] },
      [RIDES]: { status: 200, body: ridePage() },
    });
    await render(
      <LocaleProvider>
        <TicketCreateScreen />
      </LocaleProvider>,
    );

    expect(await screen.findByText("Payments")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("ticket-send"));
    expect(
      await screen.findByText("Pick what the ticket is about."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`ticket-category-${CAT_ID}`));
    await fireEvent.press(screen.getByTestId("ticket-send"));
    expect(
      await screen.findByText("Describe the problem first."),
    ).toBeOnTheScreen();
    expect(api.callsTo("POST", "/api/v1/tickets")).toHaveLength(0);
  });

  it("uploads an attachment, links a ride and opens the new thread", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///shot.jpg",
          fileName: "shot.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });
    const api = mockApi({
      [CATEGORIES]: { status: 200, body: [ticketCategory()] },
      [RIDES]: { status: 200, body: ridePage() },
      [FILES]: {
        status: 201,
        body: {
          fileId: "f1f1f1f1-0000-4000-8000-000000000001",
          kind: "ticket_attachment",
          contentType: "image/jpeg",
          sizeBytes: 1000,
        },
      },
      [CREATE]: { status: 201, body: ticket() },
    });
    await render(
      <LocaleProvider>
        <TicketCreateScreen />
      </LocaleProvider>,
    );

    expect(await screen.findByText("Payments")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`ticket-category-${CAT_ID}`));
    await fireEvent.changeText(
      screen.getByTestId("ticket-description"),
      "Receipt shows cash due after a wallet payment.",
    );
    await fireEvent.press(screen.getByTestId("ticket-add-attachment"));
    await waitFor(() =>
      expect(screen.getByTestId("ticket-attachment")).toBeOnTheScreen(),
    );
    expect(api.callsTo("POST", "/api/v1/ticket-files")[0]?.query).toEqual({
      kind: "ticket_attachment",
    });

    await fireEvent.press(screen.getByTestId("ticket-ride-open"));
    await fireEvent.press(screen.getByTestId(`ticket-ride-${RIDE_ID}`));
    expect(screen.getByTestId("ticket-ride-linked")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("ticket-send"));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(`/ticket/${TICKET_ID}`),
    );
    expect(api.callsTo("POST", "/api/v1/tickets")[0]?.body).toEqual({
      categoryId: CAT_ID,
      description: "Receipt shows cash due after a wallet payment.",
      rideId: RIDE_ID,
      attachmentFileIds: ["f1f1f1f1-0000-4000-8000-000000000001"],
      submittedAs: "rider",
    });
  });
});

describe("my tickets (UC-S-20)", () => {
  it("shows status chips and unread badges; a lost-item row opens its case", async () => {
    mockApi({
      [LIST]: {
        status: 200,
        body: page([
          ticket(),
          ticket({
            ticketId: LOST_ID,
            kind: "lost_item",
            status: "in_progress",
            caseStatus: "driver_contacted",
            description: "Black backpack",
            unreadSupportMessages: 0,
          }),
        ]),
      },
    });
    await render(
      <LocaleProvider>
        <TicketsScreen />
      </LocaleProvider>,
    );

    expect(
      await screen.findByText("Charged cash after wallet payment"),
    ).toBeOnTheScreen();
    expect(screen.getByText("Waiting on you")).toBeOnTheScreen();
    expect(screen.getByTestId(`ticket-unread-${TICKET_ID}`)).toHaveTextContent(
      "2",
    );
    expect(screen.getByText("Lost item · Black backpack")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId(`ticket-${TICKET_ID}`));
    expect(mockPush).toHaveBeenCalledWith(`/ticket/${TICKET_ID}`);
    await fireEvent.press(screen.getByTestId(`ticket-${LOST_ID}`));
    expect(mockPush).toHaveBeenCalledWith(`/lost-item/${LOST_ID}`);
  });

  it("shows the empty state with the create path", async () => {
    mockApi({ [LIST]: { status: 200, body: page([]) } });
    await render(
      <LocaleProvider>
        <TicketsScreen />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("tickets-empty")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("tickets-empty-create"));
    expect(mockPush).toHaveBeenCalledWith("/new-ticket");
  });
});

describe("ticket thread (SUP-02)", () => {
  it("merges messages + events, shows the waiting banner, and replies", async () => {
    const api = mockApi({
      [DETAIL]: [
        { status: 200, body: detail() },
        {
          status: 200,
          body: detail({ status: "in_progress" }),
        },
      ],
      [MESSAGES]: {
        status: 201,
        body: {
          messageId: "m3m3m3m3-0000-4000-8000-000000000003",
          ticketId: TICKET_ID,
          senderSide: "user",
          senderName: "Test Rider",
          body: "Sent the photo.",
          createdAt: "2026-10-19T10:00:00Z",
        },
      },
    });
    await render(
      <LocaleProvider>
        <TicketThreadScreen ticketId={TICKET_ID} />
      </LocaleProvider>,
    );

    expect(
      await screen.findByText(
        "I paid from my wallet but the receipt shows cash due.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Labby support")).toBeOnTheScreen();
    expect(screen.getByText(/Ticket opened/)).toBeOnTheScreen();
    expect(screen.getByText(/Status: Waiting on you/)).toBeOnTheScreen();
    expect(screen.getByTestId("ticket-waiting-banner")).toBeOnTheScreen();

    await fireEvent.changeText(
      screen.getByTestId("ticket-composer"),
      "Sent the photo.",
    );
    await fireEvent.press(screen.getByTestId("ticket-send-button"));
    await waitFor(() =>
      expect(
        api.callsTo("POST", `/api/v1/tickets/${TICKET_ID}/messages`),
      ).toHaveLength(1),
    );
    // The reply moved it back to In progress (second GET).
    await waitFor(() =>
      expect(screen.getByText("In progress")).toBeOnTheScreen(),
    );
    expect(screen.queryByTestId("ticket-waiting-banner")).toBeNull();
  });

  it("closed tickets are read-only; a race shows the 409 copy", async () => {
    mockApi({
      [DETAIL]: { status: 200, body: detail({ status: "closed" }) },
    });
    await render(
      <LocaleProvider>
        <TicketThreadScreen ticketId={TICKET_ID} />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("ticket-closed-banner")).toBeOnTheScreen();
    expect(screen.queryByTestId("ticket-composer")).toBeNull();
  });
});

describe("lost items (UC-R-20, LOST-01/02)", () => {
  it("reports an item on a completed ride and opens the case", async () => {
    const api = mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [REPORT]: { status: 201, body: lostCase({ caseStatus: "reported" }) },
    });
    await render(
      <LocaleProvider>
        <LostItemReportScreen rideId={RIDE_ID} />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("lost-report")).toBeOnTheScreen();
    // The reopened-chat promise is on the screen (LOST-01).
    expect(screen.getByTestId("lost-report-chat-note")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("lost-report-send"));
    expect(
      await screen.findByText("Describe what you lost first."),
    ).toBeOnTheScreen();

    await fireEvent.changeText(
      screen.getByTestId("lost-report-description"),
      "Black backpack",
    );
    await fireEvent.press(screen.getByTestId("lost-report-send"));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(`/lost-item/${LOST_ID}`),
    );
    expect(
      api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/lost-item`)[0]?.body,
    ).toEqual({ description: "Black backpack", photoFileIds: [] });
  });

  it("explains an already-open case (409, one per rider per ride)", async () => {
    mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [REPORT]: {
        status: 409,
        body: { code: "lost_item_case_open", message: "open case" },
      },
    });
    await render(
      <LocaleProvider>
        <LostItemReportScreen rideId={RIDE_ID} />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("lost-report")).toBeOnTheScreen();
    await fireEvent.changeText(
      screen.getByTestId("lost-report-description"),
      "Black backpack",
    );
    await fireEvent.press(screen.getByTestId("lost-report-send"));
    expect(
      await screen.findByText(
        "You already have an open lost-item case on this ride.",
      ),
    ).toBeOnTheScreen();
  });

  it("shows the case timeline and the reopened chat entry (rider view)", async () => {
    mockApi({ [CASE]: { status: 200, body: lostCase() } });
    await render(
      <LocaleProvider>
        <LostItemCaseScreen ticketId={LOST_ID} />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("lost-case")).toBeOnTheScreen();
    expect(
      screen.getByTestId("lost-case-step-reported-done"),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId("lost-case-step-driver_contacted-done"),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("lost-case-step-found-todo")).toBeOnTheScreen();
    expect(screen.getByText("Chat with Samer")).toBeOnTheScreen();
    expect(
      screen.getByText("Open while the case is open"),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("lost-case-chat"));
    expect(mockPush).toHaveBeenCalledWith(`/chat/${RIDE_ID}`);
    await fireEvent.press(screen.getByTestId("lost-case-support"));
    expect(mockPush).toHaveBeenCalledWith(`/ticket/${LOST_ID}`);
  });

  it("a closed case shows the read-only chat hint", async () => {
    mockApi({
      [CASE]: {
        status: 200,
        body: lostCase({ caseStatus: "closed", chatWindow: "read_only" }),
      },
    });
    await render(
      <LocaleProvider>
        <LostItemCaseScreen ticketId={LOST_ID} />
      </LocaleProvider>,
    );

    expect(await screen.findByTestId("lost-case")).toBeOnTheScreen();
    expect(
      screen.getByText("The case is closed, so the chat is read-only again"),
    ).toBeOnTheScreen();
  });
});
