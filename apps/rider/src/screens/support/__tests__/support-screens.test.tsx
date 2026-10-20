/**
 * M14-T3 support home + help center + feedback (UC-S-19/21/22, SUP-04,
 * FDBK-01) against support-v1.yaml mocks: help first on the support home
 * with the unread-replies badge; a category's published articles; the
 * article in both languages with the instant toggle (NFR-I1); search with
 * its empty state; the feedback form with the fixed catalog and the
 * `submittedAs: rider` payload; and the AR rendering of the home.
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

import {
  LANGUAGE_STORAGE_KEY,
  LocaleProvider,
} from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import FeedbackScreen from "../feedback-screen";
import HelpArticleScreen from "../help-article-screen";
import HelpCategoryScreen from "../help-category-screen";
import HelpSearchScreen from "../help-search-screen";
import SupportHomeScreen from "../support-home-screen";

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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const CATEGORY_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ARTICLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

const CATEGORIES = "GET /api/v1/help/categories";
const TICKETS = "GET /api/v1/tickets";
const ARTICLES = `GET /api/v1/help/categories/${CATEGORY_ID}/articles`;
const ARTICLE = `GET /api/v1/help/articles/${ARTICLE_ID}`;
const SEARCH = "GET /api/v1/help/search";
const FEEDBACK = "POST /api/v1/feedback";

function helpCategory(overrides = {}) {
  return {
    helpCategoryId: CATEGORY_ID,
    name: { en: "Payments & wallet", ar: "المدفوعات والمحفظة" },
    sortOrder: 0,
    articleCount: 6,
    ...overrides,
  };
}

function articleSummary(overrides = {}) {
  return {
    helpArticleId: ARTICLE_ID,
    helpCategoryId: CATEGORY_ID,
    title: {
      en: "When do I get a refund to my wallet?",
      ar: "متى يعود المبلغ إلى محفظتي؟",
    },
    sortOrder: 0,
    ...overrides,
  };
}

function ticketListPage(unread = 0) {
  return {
    items:
      unread > 0
        ? [
            {
              ticketId: "tttttttt-tttt-4ttt-8ttt-ttttttttttt1",
              kind: "ticket",
              category: {
                ticketCategoryId: "catcatca-0000-4000-8000-000000000001",
                name: { en: "Payments", ar: "المدفوعات" },
                defaultPriority: "high",
                sortOrder: 0,
              },
              priority: "high",
              status: "waiting_on_user",
              caseStatus: null,
              description: "Charged cash after wallet payment",
              ride: null,
              attachments: [],
              unreadSupportMessages: unread,
              lastMessageAt: "2026-10-18T15:40:00Z",
              createdAt: "2026-10-17T14:02:00Z",
              updatedAt: "2026-10-18T15:41:00Z",
            },
          ]
        : [],
    page: 0,
    size: 20,
    totalItems: unread > 0 ? 1 : 0,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
});

describe("support home (UC-S-19 step 1 — help first)", () => {
  it("shows help topics first, the tickets row with the unread badge, and both bottom paths", async () => {
    mockApi({
      [CATEGORIES]: { status: 200, body: [helpCategory()] },
      [TICKETS]: { status: 200, body: ticketListPage(2) },
    });
    await render(
      <LocaleProvider>
        <SupportHomeScreen />
      </LocaleProvider>,
    );

    expect(await screen.findByText("Payments & wallet")).toBeOnTheScreen();
    expect(screen.getByText("Help topics")).toBeOnTheScreen();
    expect(screen.getByText("6 articles")).toBeOnTheScreen();
    expect(screen.getByTestId("support-unread")).toHaveTextContent("2");

    await fireEvent.press(
      screen.getByTestId(`support-topic-${CATEGORY_ID}`),
    );
    expect(mockPush).toHaveBeenCalledWith(
      `/help/${CATEGORY_ID}?name=${encodeURIComponent("Payments & wallet")}`,
    );
    await fireEvent.press(screen.getByTestId("support-search"));
    expect(mockPush).toHaveBeenCalledWith("/help-search");
    await fireEvent.press(screen.getByTestId("support-tickets-row"));
    expect(mockPush).toHaveBeenCalledWith("/tickets");
    await fireEvent.press(screen.getByTestId("support-create-ticket"));
    expect(mockPush).toHaveBeenCalledWith("/new-ticket");
    await fireEvent.press(screen.getByTestId("support-feedback"));
    expect(mockPush).toHaveBeenCalledWith("/feedback");
  });

  it("renders in Arabic with the localized category name (RTL slice)", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({
      [CATEGORIES]: { status: 200, body: [helpCategory()] },
      [TICKETS]: { status: 200, body: ticketListPage(0) },
    });
    await render(
      <LocaleProvider>
        <SupportHomeScreen />
      </LocaleProvider>,
    );

    expect(await screen.findByText("المدفوعات والمحفظة")).toBeOnTheScreen();
    expect(screen.getByText("مواضيع المساعدة")).toBeOnTheScreen();
    expect(screen.getByText("إنشاء تذكرة")).toBeOnTheScreen();
  });
});

describe("help category + article (UC-S-21)", () => {
  it("lists the published articles and falls back to create-ticket (A1)", async () => {
    mockApi({ [ARTICLES]: { status: 200, body: [articleSummary()] } });
    await render(
      <LocaleProvider>
        <HelpCategoryScreen helpCategoryId={CATEGORY_ID} />
      </LocaleProvider>,
    );

    expect(
      await screen.findByText("When do I get a refund to my wallet?"),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`help-article-${ARTICLE_ID}`));
    expect(mockPush).toHaveBeenCalledWith(`/help-article/${ARTICLE_ID}`);
    await fireEvent.press(
      screen.getByTestId("help-category-create-ticket"),
    );
    expect(mockPush).toHaveBeenCalledWith("/new-ticket");
  });

  it("renders the article's paragraphs and switches language instantly (NFR-I1)", async () => {
    mockApi({
      [ARTICLE]: {
        status: 200,
        body: {
          ...articleSummary(),
          body: {
            en: "First paragraph.\n\nSecond paragraph.",
            ar: "الفقرة الأولى.\n\nالفقرة الثانية.",
          },
          publishedAt: "2026-10-10T10:00:00Z",
        },
      },
    });
    await render(
      <LocaleProvider>
        <HelpArticleScreen helpArticleId={ARTICLE_ID} />
      </LocaleProvider>,
    );

    expect(
      await screen.findByText("When do I get a refund to my wallet?"),
    ).toBeOnTheScreen();
    expect(screen.getByText("First paragraph.")).toBeOnTheScreen();
    expect(screen.getByText("Second paragraph.")).toBeOnTheScreen();

    // The toggle swaps to Arabic without another request (one payload).
    await fireEvent.press(screen.getByTestId("help-article-lang"));
    expect(screen.getByText("الفقرة الأولى.")).toBeOnTheScreen();
    expect(
      screen.getByText("متى يعود المبلغ إلى محفظتي؟"),
    ).toBeOnTheScreen();
  });
});

describe("help search (ruling 7)", () => {
  it("searches in the active language and shows results, then the empty state", async () => {
    const api = mockApi({
      [SEARCH]: [
        { status: 200, body: [articleSummary()] },
        { status: 200, body: [] },
      ],
    });
    await render(
      <LocaleProvider>
        <HelpSearchScreen />
      </LocaleProvider>,
    );

    await fireEvent.changeText(screen.getByTestId("help-search-input"), "refund");
    expect(
      await screen.findByText("When do I get a refund to my wallet?"),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("help-search-count")).toHaveTextContent(
      '1 result for "refund"',
    );
    expect(api.callsTo("GET", "/api/v1/help/search")[0]?.query).toEqual({
      q: "refund",
      lang: "en",
    });

    await fireEvent.changeText(screen.getByTestId("help-search-input"), "zzzz");
    await waitFor(() =>
      expect(screen.getByTestId("help-search-count")).toHaveTextContent(
        'Nothing found for "zzzz"',
      ),
    );
    await fireEvent.press(screen.getByTestId("help-search-create-ticket"));
    expect(mockPush).toHaveBeenCalledWith("/new-ticket");
  });

  it("shows each result under its category name (S14HelpSearch, V1 audit I55)", async () => {
    mockApi({
      [CATEGORIES]: { status: 200, body: [helpCategory()] },
      [SEARCH]: { status: 200, body: [articleSummary()] },
    });
    await render(
      <LocaleProvider>
        <HelpSearchScreen />
      </LocaleProvider>,
    );

    await fireEvent.changeText(screen.getByTestId("help-search-input"), "refund");
    await waitFor(() =>
      expect(
        screen.getByTestId(`help-search-result-${ARTICLE_ID}`),
      ).toHaveTextContent(
        /^Payments & wallet\s*When do I get a refund to my wallet\?/,
      ),
    );
  });

  it("a failed search shows the error view with retry, not the empty state", async () => {
    mockApi({
      [SEARCH]: [
        { status: 500, body: { code: "internal", message: "boom" } },
        { status: 200, body: [articleSummary()] },
      ],
    });
    await render(
      <LocaleProvider>
        <HelpSearchScreen />
      </LocaleProvider>,
    );

    await fireEvent.changeText(screen.getByTestId("help-search-input"), "refund");
    expect(await screen.findByTestId("help-search-error")).toBeOnTheScreen();
    expect(
      screen.getByText("Something went wrong on our side"),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("help-search-count")).toBeNull();

    await fireEvent.press(screen.getByTestId("error-retry"));
    expect(
      await screen.findByText("When do I get a refund to my wallet?"),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("help-search-error")).toBeNull();
  });
});

describe("feedback (UC-S-22, FDBK-01)", () => {
  it("offers the fixed catalog, requires text, and submits as rider", async () => {
    const api = mockApi({
      [FEEDBACK]: {
        status: 201,
        body: {
          feedbackId: "fbfbfbfb-0000-4000-8000-000000000001",
          category: "app_experience",
          body: "Remember my destinations",
          submittedAs: "rider",
          createdAt: "2026-10-19T10:00:00Z",
        },
      },
    });
    await render(
      <LocaleProvider>
        <FeedbackScreen />
      </LocaleProvider>,
    );

    for (const label of [
      "App experience",
      "Pricing",
      "Drivers",
      "Safety",
      "Feature request",
      "Other",
    ]) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    // No per-item reply is promised (the honest intro).
    expect(
      screen.getByText(/we can't reply to each message/),
    ).toBeOnTheScreen();

    // Empty text is refused before any request.
    await fireEvent.press(screen.getByTestId("feedback-send"));
    expect(
      await screen.findByText("Write your feedback first."),
    ).toBeOnTheScreen();
    expect(api.callsTo("POST", "/api/v1/feedback")).toHaveLength(0);

    await fireEvent.changeText(
      screen.getByTestId("feedback-body"),
      "Remember my destinations",
    );
    await fireEvent.press(screen.getByTestId("feedback-send"));
    await waitFor(() =>
      expect(screen.getByTestId("feedback-sent")).toBeOnTheScreen(),
    );
    expect(api.callsTo("POST", "/api/v1/feedback")[0]?.body).toEqual({
      category: "app_experience",
      body: "Remember my destinations",
      submittedAs: "rider",
    });
  });
});
