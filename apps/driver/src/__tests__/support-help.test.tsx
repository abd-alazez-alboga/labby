/**
 * M14-T3 — UC-S-21 for the driver against support-v1.yaml mocks: the support
 * home (help center FIRST), a category's articles, the bilingual article
 * view with its instant language toggle, and the debounced help search with
 * its create-ticket fallback. EN + AR rendering.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import {
  ARTICLE_REFUND,
  CATEGORY_PAYMENTS,
  emptyCasePage,
  emptyTicketPage,
  HELP_CATEGORIES,
  helpArticleFixture,
  helpCategoryFixture,
  LOST_ITEMS_OPEN,
  lostCaseFixture,
  ok,
  renderSupportApp,
  ticketFixture,
  TICKETS_GLANCE,
} from "../test-utils/support";

const ARTICLES = `GET /api/v1/help/categories/${CATEGORY_PAYMENTS}/articles`;
const ARTICLE = `GET /api/v1/help/articles/${ARTICLE_REFUND}`;

function homeRoutes() {
  return {
    [HELP_CATEGORIES]: ok([
      helpCategoryFixture(),
      helpCategoryFixture({
        helpCategoryId: "7b000000-0000-4000-8000-00000000000a",
        name: { en: "Safety", ar: "السلامة" },
        articleCount: 1,
        sortOrder: 1,
      }),
    ]),
    [TICKETS_GLANCE]: ok({
      items: [ticketFixture()],
      page: 0,
      size: 50,
      totalItems: 1,
    }),
    [LOST_ITEMS_OPEN]: ok({
      items: [lostCaseFixture()],
      page: 0,
      size: 50,
      totalItems: 1,
    }),
  };
}

describe("support home + help center (UC-S-19/21)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("shows the help center first: search entry, localized topics with article counts", async () => {
    await renderSupportApp(homeRoutes());

    expect(await screen.findByTestId("support-home-screen")).toBeTruthy();
    expect(screen.getByTestId("support-search-entry")).toBeTruthy();
    const topic = await screen.findByTestId(`support-topic-${CATEGORY_PAYMENTS}`);
    expect(topic).toHaveTextContent("Payments & wallet", { exact: false });
    expect(topic).toHaveTextContent("6 articles", { exact: false });
    // The ticket actions are below the help center, reachable from it.
    expect(screen.getByTestId("support-create-ticket")).toBeTruthy();
    expect(screen.getByTestId("support-feedback")).toBeTruthy();
  });

  it("'Your tickets' row: open count (tickets + open cases) and the unread badge", async () => {
    await renderSupportApp(homeRoutes());

    const row = await screen.findByTestId("support-your-tickets");
    // 1 open ticket + 1 open case; Western digits.
    expect(row).toHaveTextContent("2 open", { exact: false });
    expect(screen.getByTestId("support-unread-badge")).toHaveTextContent("2", { exact: false });
  });

  it("without tickets the row says so and shows no badge", async () => {
    await renderSupportApp({
      ...homeRoutes(),
      [TICKETS_GLANCE]: emptyTicketPage(),
      [LOST_ITEMS_OPEN]: emptyCasePage(),
    });

    const row = await screen.findByTestId("support-your-tickets");
    expect(row).toHaveTextContent("No tickets yet", { exact: false });
    expect(screen.queryByTestId("support-unread-badge")).toBeNull();
  });

  it("renders Arabic topic names in AR", async () => {
    await renderSupportApp(homeRoutes(), { language: "ar" });

    const topic = await screen.findByTestId(`support-topic-${CATEGORY_PAYMENTS}`);
    expect(topic).toHaveTextContent("المدفوعات والمحفظة", { exact: false });
  });

  it("opens a category and lists its published articles in order", async () => {
    await renderSupportApp({
      ...homeRoutes(),
      [ARTICLES]: ok([helpArticleFixture()]),
    });

    fireEvent.press(await screen.findByTestId(`support-topic-${CATEGORY_PAYMENTS}`));

    expect(await screen.findByTestId("help-category-screen")).toBeTruthy();
    const article = await screen.findByTestId(`help-article-${ARTICLE_REFUND}`);
    expect(article).toHaveTextContent("When do I get a refund to my wallet?", { exact: false });
    expect(screen.getByTestId("help-category-create-ticket")).toBeTruthy();
  });

  it("a category gone 404 (UC-S-21 E) shows the empty note, not an error", async () => {
    await renderSupportApp({
      ...homeRoutes(),
      [ARTICLES]: { status: 404 },
    });
    fireEvent.press(await screen.findByTestId(`support-topic-${CATEGORY_PAYMENTS}`));

    expect(await screen.findByTestId("help-category-gone")).toBeTruthy();
  });

  it("the article renders the app language and the toggle flips it WITHOUT refetching (NFR-I1)", async () => {
    const contract = await renderSupportApp(
      { [ARTICLE]: ok(helpArticleFixture()) },
      { initialUrl: `/help-article?helpArticleId=${ARTICLE_REFUND}` },
    );

    expect(await screen.findByTestId("help-article-title")).toHaveTextContent(
      "When do I get a refund to my wallet?",
      { exact: false },
    );
    expect(screen.getByTestId("help-article-body")).toHaveTextContent(
      "Refunds arrive as wallet credit.",
      { exact: false },
    );

    fireEvent.press(screen.getByTestId("help-article-language-toggle"));

    expect(screen.getByTestId("help-article-title")).toHaveTextContent(
      "متى تعود الأموال إلى محفظتي؟",
      { exact: false },
    );
    expect(contract.requestsTo(ARTICLE)).toHaveLength(1);
    // The fallback to a ticket stays pinned (UC-S-21 A1).
    expect(screen.getByTestId("help-article-create-ticket")).toBeTruthy();
  });

  it("an unpublished/unknown article 404s into the gone note", async () => {
    await renderSupportApp(
      { [ARTICLE]: { status: 404 } },
      { initialUrl: `/help-article?helpArticleId=${ARTICLE_REFUND}` },
    );
    expect(await screen.findByTestId("help-article-gone")).toBeTruthy();
  });

  it("search: under 2 chars sends nothing; a query debounces into ONE request", async () => {
    const search = "GET /api/v1/help/search?q=refund&lang=en";
    const contract = await renderSupportApp(
      { [search]: ok([helpArticleFixture()]) },
      { initialUrl: "/help-search" },
    );
    await screen.findByTestId("help-search-screen");

    fireEvent.changeText(screen.getByTestId("help-search-input"), "r");
    expect(screen.getByTestId("help-search-hint")).toBeTruthy();

    // Keystrokes land faster than the debounce — only the final query fires.
    fireEvent.changeText(screen.getByTestId("help-search-input"), "refu");
    fireEvent.changeText(screen.getByTestId("help-search-input"), "refund");

    expect(
      await screen.findByTestId(`help-search-result-${ARTICLE_REFUND}`),
    ).toHaveTextContent("When do I get a refund to my wallet?", { exact: false });
    expect(screen.getByTestId("help-search-count")).toHaveTextContent(
      "1 result for “refund”",
      { exact: false },
    );
    expect(contract.requests.filter((r) => r.path.includes("/help/search"))).toHaveLength(1);
  });

  it("an empty search steers to creating a ticket (UC-S-21 A1)", async () => {
    await renderSupportApp(
      { "GET /api/v1/help/search?q=teleport&lang=en": ok([]) },
      { initialUrl: "/help-search" },
    );
    await screen.findByTestId("help-search-screen");
    fireEvent.changeText(screen.getByTestId("help-search-input"), "teleport");

    const empty = await screen.findByTestId("help-search-empty");
    expect(empty).toHaveTextContent("No results for “teleport”", { exact: false });
    expect(screen.getByTestId("help-search-create-ticket")).toBeTruthy();
  });

  it("search uses the Arabic language parameter in AR", async () => {
    const search = `GET /api/v1/help/search?q=${encodeURIComponent("محفظة")}&lang=ar`;
    await renderSupportApp(
      { [search]: ok([helpArticleFixture()]) },
      { language: "ar", initialUrl: "/help-search" },
    );
    await screen.findByTestId("help-search-screen");
    fireEvent.changeText(screen.getByTestId("help-search-input"), "محفظة");

    const result = await screen.findByTestId(`help-search-result-${ARTICLE_REFUND}`);
    expect(result).toHaveTextContent("متى تعود الأموال إلى محفظتي؟", { exact: false });
  });

  it("the settings screen links to the support home", async () => {
    await renderSupportApp(homeRoutes(), { initialUrl: "/settings" });

    fireEvent.press(await screen.findByTestId("settings-link-support"));
    expect(await screen.findByTestId("support-home-screen")).toBeTruthy();
  });

  it("surfaces a load failure with retry", async () => {
    await renderSupportApp({
      [HELP_CATEGORIES]: [{ status: 500 }, ok([helpCategoryFixture()])],
      [TICKETS_GLANCE]: emptyTicketPage(),
      [LOST_ITEMS_OPEN]: emptyCasePage(),
    });

    expect(await screen.findByTestId("support-error")).toBeTruthy();
    fireEvent.press(screen.getByTestId("failure-retry"));
    expect(
      await screen.findByTestId(`support-topic-${CATEGORY_PAYMENTS}`),
    ).toBeTruthy();
  });
});
