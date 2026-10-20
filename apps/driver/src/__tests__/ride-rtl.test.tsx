/**
 * M7-T4 — the offer card and the in-ride screen in Arabic: Arabic copy,
 * right-aligned text and rows mirrored by hand (native layout is still LTR
 * in tests, as right after a language switch before the restart).
 */
import { StyleSheet } from "react-native";

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
import {
  inProgressRide,
  offerFixture,
  offerNewFrame,
} from "../test-utils/rides";

const originalWebSocket = globalThis.WebSocket;

function flexDirectionOf(testID: string): unknown {
  const node = screen.getByTestId(testID);
  return StyleSheet.flatten(node.props.style)?.flexDirection;
}

describe("ride screens in Arabic (RTL)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    MockSocket.reset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    await clearSession();
    await initI18n();
    await setAppLanguage("ar");
    mockLocationGranted();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("renders the offer card mirrored with Arabic copy", async () => {
    const contract = await renderDriverApp({}, { language: "ar" });
    const socket = await goLive();
    await waitForResync(contract);
    receive(socket, offerNewFrame(offerFixture()));

    expect(await screen.findByTestId("offer-card")).toBeTruthy();
    expect(screen.getByTestId("offer-service")).toHaveTextContent(
      "اقتصادي · نقداً",
    );
    expect(screen.getByText("قبول")).toBeTruthy();
    expect(screen.getByText("الأجرة التقديرية")).toHaveStyle({
      textAlign: "right",
    });
    // Amount first (LTR-isolated, Western digits), then "ل.س" (W20).
    expect(screen.getByTestId("offer-fare").props.children).toMatch(
      /^\u2066[0-9,.]+\u2069 ل\.س$/u,
    );
    // Header row (chip | countdown) and the actions row are mirrored.
    const card = screen.getByTestId("offer-card");
    const header = card.children[0];
    if (typeof header === "string") throw new Error("expected the header");
    expect(StyleSheet.flatten(header.props.style)?.flexDirection).toBe(
      "row-reverse",
    );
    expect(screen.getByTestId("offer-decline").props.accessibilityLabel).toBe(
      "رفض",
    );
  });

  it("renders the in-ride screen mirrored with Arabic copy", async () => {
    const contract = await renderDriverApp(
      { [ACTIVE_RIDE]: { status: 200, body: inProgressRide() } },
      { language: "ar" },
    );
    await goLive();
    await waitForResync(contract);

    expect(await screen.findByTestId("in-ride-sheet")).toBeTruthy();
    expect(screen.getByText("إلى الوجهة")).toHaveStyle({ textAlign: "right" });
    expect(screen.getByText("أنهِ الرحلة")).toBeTruthy();
    expect(screen.getByTestId("ride-destination")).toHaveTextContent(
      "الوجهة",
      { exact: false },
    );
    expect(screen.getByTestId("in-ride-instruction-subtitle")).toHaveTextContent(
      "الوجهة ·",
      { exact: false },
    );
    expect(flexDirectionOf("in-ride-instruction")).toBe("row-reverse");
  });
});
