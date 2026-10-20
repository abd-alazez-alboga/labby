/**
 * V1 audit W39 (UC-R-04 E3 — approved artboard V1FRiderSuspendedTicket):
 * "Contact support" on a suspension opens the create-ticket flow
 * pre-filled — the category whose `systemCode` is `account_suspend`
 * selected when the server has it (none selected when it does not, or the
 * field is missing), the description drafted with the reason in plain
 * words (editable), and a note saying it was filled in.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";

import type { UserProfile } from "../../../api/auth";
import { AuthProvider } from "../../../auth/auth-context";
import {
  LANGUAGE_STORAGE_KEY,
  LocaleProvider,
} from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  accountSuspended,
  riderRoleSuspended,
} from "../../../test-utils/trust-fixtures";
import TicketCreateScreen from "../ticket-create-screen";

jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: MockText } = require("react-native");
  return {
    Ionicons: ({ name }: { name: string }) => (
      <MockText testID={`icon-${name}`}>{name}</MockText>
    ),
  };
});

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: mockReplace,
    canGoBack: () => true,
  }),
}));

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const ME = "GET /api/v1/users/me";
const CATEGORIES = "GET /api/v1/support/ticket-categories";
const RIDES = "GET /api/v1/rides";
const CREATE = "POST /api/v1/tickets";
const TICKET_ID = "tttttttt-tttt-4ttt-8ttt-ttttttttttt2";
const PAYMENTS_ID = "catcatca-0000-4000-8000-000000000001";
const SUSPEND_ID = "catcatca-0000-4000-8000-000000000002";

const NOTE = "Repeated abusive messages to drivers in ride chat.";

const payments = {
  ticketCategoryId: PAYMENTS_ID,
  name: { en: "Payments", ar: "المدفوعات" },
  defaultPriority: "normal",
  sortOrder: 0,
  systemCode: null,
};
const accountSuspend = {
  ticketCategoryId: SUSPEND_ID,
  name: { en: "Account & suspension", ar: "الحساب والإيقاف" },
  defaultPriority: "high",
  sortOrder: 1,
  systemCode: "account_suspend",
};
// An older server: no `systemCode` field, no suspension category.
const legacyPayments = {
  ticketCategoryId: PAYMENTS_ID,
  name: { en: "Payments", ar: "المدفوعات" },
  defaultPriority: "normal",
  sortOrder: 0,
};

const emptyRides = { items: [], page: 0, size: 20, totalItems: 0 };

async function renderSignedIn(
  user: UserProfile,
  reason: string | null = null,
) {
  await seedSignedInSession(user);
  return render(
    <LocaleProvider>
      <AuthProvider>
        <TicketCreateScreen aboutSuspension={{ reason }} />
      </AuthProvider>
    </LocaleProvider>,
  );
}

function checked(id: string): boolean {
  return !!screen.getByTestId(`ticket-category-${id}`).props.accessibilityState
    ?.checked;
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
});

describe("suspension ticket, pre-filled (W39)", () => {
  it("selects account_suspend and drafts the admin's note; sends it as edited", async () => {
    const user = riderRoleSuspended("manual", NOTE);
    const api = mockApi({
      [ME]: { status: 200, body: user },
      [CATEGORIES]: { status: 200, body: [payments, accountSuspend] },
      [RIDES]: { status: 200, body: emptyRides },
      [CREATE]: {
        status: 201,
        body: {
          ticketId: TICKET_ID,
          kind: "ticket",
          category: accountSuspend,
          priority: "high",
          status: "open",
          caseStatus: null,
          description: "x",
          ride: null,
          attachments: [],
          unreadSupportMessages: 0,
          createdAt: "2026-10-20T09:00:00Z",
          updatedAt: "2026-10-20T09:00:00Z",
        },
      },
    });
    await renderSignedIn(user, "manual");

    expect(await screen.findByText("Account & suspension")).toBeOnTheScreen();
    expect(screen.getByTestId("ticket-create-notice")).toHaveTextContent(
      "We filled this in about your suspension. Add anything that helps our team review it.",
    );
    expect(checked(SUSPEND_ID)).toBe(true);
    expect(checked(PAYMENTS_ID)).toBe(false);
    const draft = `My rider account was suspended. Reason shown: “${NOTE}” I'd like my account to be reviewed.`;
    expect(screen.getByTestId("ticket-description").props.value).toBe(draft);

    // Editable before sending.
    await fireEvent.changeText(
      screen.getByTestId("ticket-description"),
      `${draft} It was a misunderstanding.`,
    );
    await fireEvent.press(screen.getByTestId("ticket-send"));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(`/ticket/${TICKET_ID}`),
    );
    expect(api.callsTo("POST", "/api/v1/tickets")[0]?.body).toEqual({
      categoryId: SUSPEND_ID,
      description: `${draft} It was a misunderstanding.`,
      rideId: null,
      attachmentFileIds: [],
      submittedAs: "rider",
    });
  });

  it("without the category (or systemCode) nothing is pre-selected; the draft stays", async () => {
    const api = mockApi({
      [CATEGORIES]: { status: 200, body: [legacyPayments] },
      [RIDES]: { status: 200, body: emptyRides },
    });
    // From a booking refusal before the profile re-read: the 403's reason.
    await render(
      <LocaleProvider>
        <TicketCreateScreen aboutSuspension={{ reason: "low_rating" }} />
      </LocaleProvider>,
    );

    expect(await screen.findByText("Payments")).toBeOnTheScreen();
    expect(checked(PAYMENTS_ID)).toBe(false);
    expect(screen.getByTestId("ticket-description").props.value).toBe(
      "My rider account was suspended. Reason shown: “Your average rider rating fell below the minimum allowed in your area.” I'd like my account to be reviewed.",
    );
    expect(screen.getByTestId("ticket-create-notice")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("ticket-send"));
    expect(
      await screen.findByText("Pick what the ticket is about."),
    ).toBeOnTheScreen();
    expect(api.callsTo("POST", "/api/v1/tickets")).toHaveLength(0);
  });

  it("a whole-account suspension says so; an unknown reason is left out", async () => {
    const user = accountSuspended(null);
    mockApi({
      [ME]: { status: 200, body: user },
      [CATEGORIES]: { status: 200, body: [accountSuspend] },
      [RIDES]: { status: 200, body: emptyRides },
    });
    await renderSignedIn(user);

    expect(await screen.findByText("Account & suspension")).toBeOnTheScreen();
    expect(screen.getByTestId("ticket-description").props.value).toBe(
      "My Labby account was suspended. I'd like my account to be reviewed.",
    );
  });

  it("an ordinary ticket is not pre-filled", async () => {
    mockApi({
      [CATEGORIES]: { status: 200, body: [payments, accountSuspend] },
      [RIDES]: { status: 200, body: emptyRides },
    });
    await render(
      <LocaleProvider>
        <TicketCreateScreen />
      </LocaleProvider>,
    );

    expect(await screen.findByText("Account & suspension")).toBeOnTheScreen();
    expect(checked(SUSPEND_ID)).toBe(false);
    expect(screen.getByTestId("ticket-description").props.value).toBe("");
    expect(screen.queryByTestId("ticket-create-notice")).toBeNull();
  });

  it("drafts in Arabic", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({
      [CATEGORIES]: { status: 200, body: [accountSuspend] },
      [RIDES]: { status: 200, body: emptyRides },
    });
    await render(
      <LocaleProvider>
        <TicketCreateScreen aboutSuspension={{ reason: "low_rating" }} />
      </LocaleProvider>,
    );

    expect(await screen.findByText("الحساب والإيقاف")).toBeOnTheScreen();
    expect(checked(SUSPEND_ID)).toBe(true);
    expect(screen.getByTestId("ticket-description").props.value).toBe(
      "تم إيقاف حسابي كراكب. السبب المعروض: «انخفض متوسط تقييمك كراكب عن الحد الأدنى المسموح به في منطقتك.» أرجو مراجعة حسابي.",
    );
    expect(screen.getByTestId("ticket-create-notice")).toHaveTextContent(
      "عبّأنا هذه التذكرة عن إيقاف حسابك. أضف ما يساعد فريقنا على مراجعته.",
    );
  });
});
