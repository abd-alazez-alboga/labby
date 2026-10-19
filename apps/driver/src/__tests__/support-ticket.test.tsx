/**
 * M14-T3 — UC-S-19/20 for the driver against support-v1.yaml mocks: creating
 * a ticket (category, description, ≤ 5 attachments via /ticket-files, the
 * optional ride link, the 400/404/409 refusals), the merged tickets list
 * (tickets + the driver's lost-item cases, chips, badges, paging), and the
 * thread (order, waiting banner, composer, closed read-only, `ticket_closed`).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { mockDocumentPick } from "../test-utils/onboarding";
import {
  CATEGORY_RIDES,
  coded,
  CREATE_TICKET,
  eventFixture,
  LOST_ITEMS,
  lostCaseFixture,
  LOST_TICKET_ID,
  messageFixture,
  ok,
  RECENT_TRIPS,
  renderSupportApp,
  TICKET_CATEGORIES,
  TICKET_FILES,
  TICKET_ID,
  ticketCategoryFixture,
  ticketDetailFixture,
  ticketFixture,
  TICKETS,
} from "../test-utils/support";

const TICKET_DETAIL = `GET /api/v1/tickets/${TICKET_ID}`;
const POST_MESSAGE = `POST /api/v1/tickets/${TICKET_ID}/messages`;
const RIDE_ID = "11000000-0000-4000-8000-00000000000a";

const uploadedFile = (n: number) =>
  ok({
    fileId: `7d000000-0000-4000-8000-00000000000${n}`,
    kind: "ticket_attachment",
    contentType: "application/pdf",
    sizeBytes: 4096,
  });

const tripFixture = {
  rideId: RIDE_ID,
  completedAt: "2026-10-17T12:00:00Z",
  currency: "SYP",
  fareTotal: 42500,
  paymentMethod: "cash",
  commissionRate: 10,
  commissionAmount: 4250,
  net: -4250,
};

function createRoutes() {
  return {
    [TICKET_CATEGORIES]: ok([
      ticketCategoryFixture(),
      ticketCategoryFixture({
        ticketCategoryId: "7b000000-0000-4000-8000-00000000000b",
        name: { en: "App issue", ar: "مشكلة في التطبيق" },
        sortOrder: 1,
      }),
    ]),
  };
}

describe("support tickets (UC-S-19/20)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("creates a ticket: category + description + attachments + ride link → the thread", async () => {
    const contract = await renderSupportApp(
      {
        ...createRoutes(),
        [TICKET_FILES]: [uploadedFile(1), uploadedFile(2)],
        [RECENT_TRIPS]: ok({ items: [tripFixture], page: 0, size: 5, totalItems: 1, totalPages: 1 }),
        [CREATE_TICKET]: { status: 201, body: ticketFixture() },
        [TICKET_DETAIL]: ok(ticketDetailFixture()),
      },
      { initialUrl: "/ticket-create" },
    );
    await screen.findByTestId("ticket-create-screen");

    // Send waits for a category and a description.
    expect(
      screen.getByTestId("ticket-create-send").props.accessibilityState.disabled,
    ).toBe(true);
    fireEvent.press(await screen.findByTestId(`ticket-category-${CATEGORY_RIDES}`));
    fireEvent.changeText(
      screen.getByTestId("ticket-description"),
      " The receipt shows cash due after a wallet payment. ",
    );

    mockDocumentPick("receipt.pdf");
    fireEvent.press(screen.getByTestId("ticket-add-attachment"));
    expect(await screen.findByTestId("ticket-attachment-0")).toBeTruthy();
    mockDocumentPick("photo.jpg", "image/jpeg");
    fireEvent.press(screen.getByTestId("ticket-add-attachment"));
    expect(await screen.findByTestId("ticket-attachment-1")).toBeTruthy();
    expect(contract.requestsTo(TICKET_FILES)).toHaveLength(2);
    expect(contract.requestsTo(TICKET_FILES)[0].body).toBeInstanceOf(FormData);

    fireEvent.press(screen.getByTestId("ticket-link-ride"));
    fireEvent.press(await screen.findByTestId(`ticket-ride-option-${RIDE_ID}`));
    expect(screen.getByTestId("ticket-ride-selected")).toBeTruthy();

    fireEvent.press(screen.getByTestId("ticket-create-send"));

    expect(await screen.findByTestId("ticket-thread-screen")).toBeTruthy();
    expect(contract.requestsTo(CREATE_TICKET)[0].body).toEqual({
      categoryId: CATEGORY_RIDES,
      description: "The receipt shows cash due after a wallet payment.",
      rideId: RIDE_ID,
      attachmentFileIds: [
        "7d000000-0000-4000-8000-000000000001",
        "7d000000-0000-4000-8000-000000000002",
      ],
      submittedAs: "driver",
    });
  });

  it("caps attachments at 5 and uploads can be removed before sending", async () => {
    await renderSupportApp(
      {
        ...createRoutes(),
        [TICKET_FILES]: [1, 2, 3, 4, 5].map((n) => uploadedFile(n)),
      },
      { initialUrl: "/ticket-create" },
    );
    await screen.findByTestId("ticket-create-screen");

    for (let n = 1; n <= 5; n += 1) {
      mockDocumentPick(`a${n}.pdf`);
      fireEvent.press(screen.getByTestId("ticket-add-attachment"));
      expect(await screen.findByTestId(`ticket-attachment-${n - 1}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("ticket-add-attachment")).toBeNull();

    fireEvent.press(screen.getByTestId("ticket-attachment-remove-4"));
    expect(screen.queryByTestId("ticket-attachment-4")).toBeNull();
    expect(screen.getByTestId("ticket-add-attachment")).toBeTruthy();
  });

  it.each([
    [400, "file_rejected", "couldn't be used"],
    [413, "file_too_large", "too large"],
    [429, "daily_upload_limit", "today's upload limit"],
  ])("maps an upload %s to friendly copy and keeps the form", async (status, code, copy) => {
    await renderSupportApp(
      {
        ...createRoutes(),
        [TICKET_FILES]: [coded(status, code), uploadedFile(1)],
      },
      { initialUrl: "/ticket-create" },
    );
    await screen.findByTestId("ticket-create-screen");

    mockDocumentPick("receipt.pdf");
    fireEvent.press(screen.getByTestId("ticket-add-attachment"));
    expect(await screen.findByTestId("ticket-attachment-error")).toHaveTextContent(copy, {
      exact: false,
    });
    expect(screen.queryByTestId("ticket-attachment-0")).toBeNull();

    // A retry that succeeds clears the error.
    mockDocumentPick("receipt.pdf");
    fireEvent.press(screen.getByTestId("ticket-add-attachment"));
    expect(await screen.findByTestId("ticket-attachment-0")).toBeTruthy();
    expect(screen.queryByTestId("ticket-attachment-error")).toBeNull();
  });

  it("maps a 409 category refusal and a 404 to friendly copy", async () => {
    await renderSupportApp(
      {
        ...createRoutes(),
        [CREATE_TICKET]: [
          coded(409, "category_inactive"),
          coded(404, "not_found"),
        ],
      },
      { initialUrl: "/ticket-create" },
    );
    await screen.findByTestId("ticket-create-screen");
    fireEvent.press(await screen.findByTestId(`ticket-category-${CATEGORY_RIDES}`));
    fireEvent.changeText(screen.getByTestId("ticket-description"), "Help");

    fireEvent.press(screen.getByTestId("ticket-create-send"));
    expect(
      await screen.findByTestId("ticket-create-error-categoryUnavailable"),
    ).toHaveTextContent("isn't available any more", { exact: false });

    fireEvent.press(screen.getByTestId("ticket-create-send"));
    expect(await screen.findByTestId("ticket-create-error-notFound")).toBeTruthy();
  });

  it("lists tickets AND the driver's lost-item cases, newest first, with chips and badges", async () => {
    await renderSupportApp(
      {
        [TICKETS]: ok({
          items: [
            ticketFixture(),
            ticketFixture({
              ticketId: "7c000000-0000-4000-8000-00000000000c",
              status: "closed",
              description: "Driver took a long route",
              unreadSupportMessages: 0,
              updatedAt: "2026-09-28T10:00:00Z",
            }),
          ],
          page: 0,
          size: 20,
          totalItems: 2,
        }),
        [LOST_ITEMS]: ok({
          items: [lostCaseFixture()],
          page: 0,
          size: 50,
          totalItems: 1,
        }),
      },
      { initialUrl: "/tickets" },
    );

    expect(await screen.findByTestId("tickets-list")).toBeTruthy();
    // The case updated last (2026-10-19) → first row.
    expect(screen.getByTestId(`ticket-chip-${LOST_TICKET_ID}`)).toHaveTextContent(
      "Driver contacted",
    );
    expect(screen.getByTestId(`ticket-row-${LOST_TICKET_ID}`)).toHaveTextContent(
      "Lost item",
      { exact: false },
    );
    expect(screen.getByTestId(`ticket-chip-${TICKET_ID}`)).toHaveTextContent(
      "Waiting on you",
    );
    expect(screen.getByTestId(`ticket-unread-${TICKET_ID}`)).toHaveTextContent("2");

    // A case row opens the case view, not the thread (UC-D-21).
    fireEvent.press(screen.getByTestId(`ticket-row-${LOST_TICKET_ID}`));
    expect(await screen.findByTestId("lost-case-screen")).toBeTruthy();
  });

  it("pages older tickets with \"show older\"", async () => {
    const page1 = "GET /api/v1/tickets?page=1&size=20";
    const olderId = "7c000000-0000-4000-8000-0000000000ff";
    const contract = await renderSupportApp(
      {
        [TICKETS]: ok({
          items: Array.from({ length: 20 }, (_, i) =>
            ticketFixture({
              ticketId: `7c000000-0000-4000-8000-0000000000${String(10 + i)}`,
            }),
          ),
          page: 0,
          size: 20,
          totalItems: 21,
        }),
        [LOST_ITEMS]: ok({ items: [], page: 0, size: 50, totalItems: 0 }),
        [page1]: ok({
          items: [ticketFixture({ ticketId: olderId, updatedAt: "2026-09-01T10:00:00Z" })],
          page: 1,
          size: 20,
          totalItems: 21,
        }),
      },
      { initialUrl: "/tickets" },
    );

    fireEvent.press(await screen.findByTestId("tickets-load-more"));
    expect(await screen.findByTestId(`ticket-row-${olderId}`)).toBeTruthy();
    expect(contract.requestsTo(page1)).toHaveLength(1);
    expect(screen.queryByTestId("tickets-load-more")).toBeNull();
  });

  it("keeps the merged order across pages: older tickets slot between cases by updatedAt", async () => {
    const page1 = "GET /api/v1/tickets?page=1&size=20";
    const id = (n: number) => `7c000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
    const caseNew = "7c000000-0000-4000-8000-0000000002a1";
    const caseOld = "7c000000-0000-4000-8000-0000000002a2";
    await renderSupportApp(
      {
        // Page 0: 20 tickets, all updated on 2026-10-10.
        [TICKETS]: ok({
          items: Array.from({ length: 20 }, (_, i) =>
            ticketFixture({
              ticketId: id(i),
              unreadSupportMessages: 0,
              updatedAt: `2026-10-10T${String(20 - i).padStart(2, "0")}:00:00Z`,
            }),
          ),
          page: 0,
          size: 20,
          totalItems: 22,
        }),
        [LOST_ITEMS]: ok({
          items: [
            lostCaseFixture({ ticketId: caseNew, updatedAt: "2026-10-12T10:00:00Z" }),
            lostCaseFixture({ ticketId: caseOld, updatedAt: "2026-09-01T10:00:00Z" }),
          ],
          page: 0,
          size: 50,
          totalItems: 2,
        }),
        // Page 1: one ticket newer than the old case, one older.
        [page1]: ok({
          items: [
            ticketFixture({ ticketId: id(20), updatedAt: "2026-09-15T10:00:00Z" }),
            ticketFixture({ ticketId: id(21), updatedAt: "2026-08-15T10:00:00Z" }),
          ],
          page: 1,
          size: 20,
          totalItems: 22,
        }),
      },
      { initialUrl: "/tickets" },
    );

    fireEvent.press(await screen.findByTestId("tickets-load-more"));
    await screen.findByTestId(`ticket-row-${id(21)}`);
    const order = screen
      .getAllByTestId(/^ticket-row-/)
      .map((row) => String(row.props.testID).replace("ticket-row-", ""));
    expect(order).toEqual([
      caseNew,
      ...Array.from({ length: 20 }, (_, i) => id(i)),
      id(20),
      caseOld,
      id(21),
    ]);
    expect(screen.queryByTestId("tickets-load-more")).toBeNull();
  });

  it("\"show older\" is busy while a page loads — a double tap fires one request", async () => {
    const page1 = "GET /api/v1/tickets?page=1&size=20";
    const contract = await renderSupportApp(
      {
        [TICKETS]: ok({
          items: Array.from({ length: 20 }, (_, i) =>
            ticketFixture({ ticketId: `7c000000-0000-4000-8000-0000000000${String(10 + i)}` }),
          ),
          page: 0,
          size: 20,
          totalItems: 21,
        }),
        [LOST_ITEMS]: ok({ items: [], page: 0, size: 50, totalItems: 0 }),
        [page1]: ok({
          items: [ticketFixture({ ticketId: "7c000000-0000-4000-8000-0000000000ff" })],
          page: 1,
          size: 20,
          totalItems: 21,
        }),
      },
      { initialUrl: "/tickets" },
    );

    const more = await screen.findByTestId("tickets-load-more");
    fireEvent.press(more);
    fireEvent.press(screen.getByTestId("tickets-load-more"));
    expect(await screen.findByTestId("ticket-row-7c000000-0000-4000-8000-0000000000ff")).toBeTruthy();
    expect(contract.requestsTo(page1)).toHaveLength(1);
  });

  it("a failed older page keeps the list and retries inline", async () => {
    const page1 = "GET /api/v1/tickets?page=1&size=20";
    const olderId = "7c000000-0000-4000-8000-0000000000ff";
    const contract = await renderSupportApp(
      {
        [TICKETS]: ok({
          items: Array.from({ length: 20 }, (_, i) =>
            ticketFixture({ ticketId: `7c000000-0000-4000-8000-0000000000${String(10 + i)}` }),
          ),
          page: 0,
          size: 20,
          totalItems: 21,
        }),
        [LOST_ITEMS]: ok({ items: [], page: 0, size: 50, totalItems: 0 }),
        [page1]: [
          { status: 500 },
          ok({
            items: [ticketFixture({ ticketId: olderId })],
            page: 1,
            size: 20,
            totalItems: 21,
          }),
        ],
      },
      { initialUrl: "/tickets" },
    );

    fireEvent.press(await screen.findByTestId("tickets-load-more"));
    expect(await screen.findByTestId("tickets-more-error")).toHaveTextContent(
      "Couldn't load older tickets.",
      { exact: false },
    );
    // The loaded list stays; only the footer turns into the retry.
    expect(screen.getByTestId("tickets-list")).toBeTruthy();
    expect(screen.getByTestId("ticket-row-7c000000-0000-4000-8000-000000000010")).toBeTruthy();
    expect(screen.queryByTestId("tickets-error")).toBeNull();
    expect(screen.queryByTestId("tickets-load-more")).toBeNull();

    fireEvent.press(screen.getByTestId("tickets-more-retry"));
    expect(await screen.findByTestId(`ticket-row-${olderId}`)).toBeTruthy();
    expect(screen.queryByTestId("tickets-more-error")).toBeNull();
    expect(contract.requestsTo(page1)).toHaveLength(2);
  });

  it("renders the thread oldest first with events, the waiting banner and composer", async () => {
    const contract = await renderSupportApp(
      {
        [TICKET_DETAIL]: ok(ticketDetailFixture()),
        [POST_MESSAGE]: {
          status: 201,
          body: messageFixture({
            messageId: "7d100000-0000-4000-8000-00000000000f",
            body: "Here is the photo.",
          }),
        },
      },
      { initialUrl: `/ticket?ticketId=${TICKET_ID}` },
    );

    expect(await screen.findByTestId("thread-title")).toHaveTextContent(
      "Charged cash after wallet payment",
    );
    expect(screen.getByTestId("thread-status")).toHaveTextContent("Waiting on you");
    expect(screen.getByTestId("thread-waiting-banner")).toBeTruthy();
    expect(
      screen.getByTestId("thread-message-7d100000-0000-4000-8000-000000000002"),
    ).toHaveTextContent("Labby support", { exact: false });
    // The status event renders as a centered marker with the status label.
    expect(
      screen.getByTestId("thread-event-7d200000-0000-4000-8000-000000000001"),
    ).toHaveTextContent("Waiting on you", { exact: false });

    // Reply: posted, then the thread re-reads (reply may reopen the ticket).
    fireEvent.changeText(screen.getByTestId("thread-input"), " Here is the photo. ");
    fireEvent.press(screen.getByTestId("thread-send"));
    await waitFor(() => expect(contract.requestsTo(POST_MESSAGE)).toHaveLength(1));
    expect(contract.requestsTo(POST_MESSAGE)[0].body).toEqual({
      body: "Here is the photo.",
    });
    await waitFor(() => expect(contract.requestsTo(TICKET_DETAIL)).toHaveLength(2));
  });

  it("a closed ticket is read-only (no composer)", async () => {
    await renderSupportApp(
      {
        [TICKET_DETAIL]: ok(
          ticketDetailFixture({ status: "closed", events: [eventFixture({ toValue: "closed" })] }),
        ),
      },
      { initialUrl: `/ticket?ticketId=${TICKET_ID}` },
    );

    expect(await screen.findByTestId("thread-closed-notice")).toBeTruthy();
    expect(screen.queryByTestId("thread-input")).toBeNull();
  });

  it("a racing 409 ticket_closed flips the thread to read-only (UC-S-20 E)", async () => {
    await renderSupportApp(
      {
        [TICKET_DETAIL]: [
          ok(ticketDetailFixture({ status: "resolved" })),
          ok(ticketDetailFixture({ status: "closed" })),
        ],
        [POST_MESSAGE]: coded(409, "ticket_closed"),
      },
      { initialUrl: `/ticket?ticketId=${TICKET_ID}` },
    );
    await screen.findByTestId("thread-title");
    expect(screen.getByTestId("thread-resolved-hint")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("thread-input"), "Still broken");
    fireEvent.press(screen.getByTestId("thread-send"));

    expect(await screen.findByTestId("thread-closed-notice")).toBeTruthy();
    expect(screen.queryByTestId("thread-input")).toBeNull();
  });

  it("renders the thread in Arabic with RTL status copy", async () => {
    await setAppLanguage("ar");
    await renderSupportApp(
      { [TICKET_DETAIL]: ok(ticketDetailFixture()) },
      { language: "ar", initialUrl: `/ticket?ticketId=${TICKET_ID}` },
    );

    expect(await screen.findByTestId("thread-status")).toHaveTextContent(
      "بانتظار ردك",
    );
    expect(screen.getByTestId("thread-waiting-banner")).toHaveTextContent(
      "الدعم بانتظار ردك",
      { exact: false },
    );
  });
});
