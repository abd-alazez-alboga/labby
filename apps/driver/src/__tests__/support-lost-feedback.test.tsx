/**
 * M14-T3 — UC-D-21 + UC-S-22 for the driver against support-v1.yaml mocks:
 * the lost-item case view (status chip, ride, the rider's description +
 * photos, the reopened-chat entry point, click-to-dial from the chat
 * thread's phone, the offline note), the closed-case state, the feedback
 * form (fixed catalog, `submittedAs: driver`, no reply promised), and the
 * M14 push deep links.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";
import { Linking } from "react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { hrefForLink } from "../notifications/deep-links";
import {
  coded,
  FEEDBACK,
  lostCaseFixture,
  LOST_RIDE_ID,
  LOST_TICKET_ID,
  ok,
  renderSupportApp,
} from "../test-utils/support";

const LOST_CASE = `GET /api/v1/lost-items/${LOST_TICKET_ID}`;
const CHAT_THREAD = `GET /api/v1/rides/${LOST_RIDE_ID}/chat`;

const threadFixture = (phone: string | null) =>
  ok({
    rideId: LOST_RIDE_ID,
    windowState: phone ? "reopened" : "read_only",
    openedAt: "2026-10-18T18:00:00Z",
    closedAt: "2026-10-18T20:00:00Z",
    unreadCount: 0,
    counterpart: { role: "rider", firstName: "Rana", phone },
  });

describe("lost-item case view (UC-D-21) + feedback (UC-S-22)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("shows the case: chip, ride + rider, description, photos, the reopened-chat note", async () => {
    await renderSupportApp(
      {
        [LOST_CASE]: ok(lostCaseFixture()),
        [CHAT_THREAD]: threadFixture("+963955555555"),
      },
      { initialUrl: `/lost-item-case?ticketId=${LOST_TICKET_ID}` },
    );

    expect(await screen.findByTestId("lost-case-screen")).toBeTruthy();
    expect(await screen.findByTestId("lost-case-status")).toHaveTextContent(
      "Driver contacted",
    );
    expect(screen.getByTestId("lost-case-ride")).toHaveTextContent("rider Rana", {
      exact: false,
    });
    expect(screen.getByTestId("lost-case-description")).toHaveTextContent(
      "Black backpack",
      { exact: false },
    );
    expect(screen.getByTestId("lost-case-photo-0")).toBeTruthy();
    expect(screen.getByTestId("lost-case-note")).toBeTruthy();
    // M10 offline rule, stated on the screen (calls work anytime).
    expect(screen.getByText("Offline? Go online to send chat messages — calls work anytime.")).toBeTruthy();
  });

  it("'Open ride chat' deep-links into the ride's chat screen (the reopened thread)", async () => {
    await renderSupportApp(
      {
        [LOST_CASE]: ok(lostCaseFixture()),
        [CHAT_THREAD]: threadFixture("+963955555555"),
      },
      { initialUrl: `/lost-item-case?ticketId=${LOST_TICKET_ID}` },
    );

    fireEvent.press(await screen.findByTestId("lost-case-open-chat"));
    expect(await screen.findByTestId("chat-route")).toBeTruthy();
  });

  it("'Call Rana' dials the rider's number from the chat thread (CALL-01)", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockResolvedValue(undefined as never);
    await renderSupportApp(
      {
        [LOST_CASE]: ok(lostCaseFixture()),
        [CHAT_THREAD]: threadFixture("+963955555555"),
      },
      { initialUrl: `/lost-item-case?ticketId=${LOST_TICKET_ID}` },
    );

    const call = await screen.findByTestId("lost-case-call");
    expect(call).toHaveTextContent("Call Rana", { exact: false });
    fireEvent.press(call);
    expect(openURL).toHaveBeenCalledWith("tel:+963955555555");
  });

  it("hides Call while the thread serves no phone, and the chat entry on a closed case", async () => {
    await renderSupportApp(
      {
        [LOST_CASE]: ok(
          lostCaseFixture({ caseStatus: "closed", status: "closed", chatWindow: "read_only" }),
        ),
        [CHAT_THREAD]: threadFixture(null),
      },
      { initialUrl: `/lost-item-case?ticketId=${LOST_TICKET_ID}` },
    );

    expect(await screen.findByTestId("lost-case-closed-note")).toBeTruthy();
    expect(screen.queryByTestId("lost-case-open-chat")).toBeNull();
    expect(screen.queryByTestId("lost-case-call")).toBeNull();
  });

  it("a case I'm no party to (404) shows the gone note", async () => {
    await renderSupportApp(
      { [LOST_CASE]: { status: 404 } },
      { initialUrl: `/lost-item-case?ticketId=${LOST_TICKET_ID}` },
    );
    expect(await screen.findByTestId("lost-case-gone")).toBeTruthy();
  });

  it("renders the case in Arabic", async () => {
    await setAppLanguage("ar");
    await renderSupportApp(
      {
        [LOST_CASE]: ok(lostCaseFixture()),
        [CHAT_THREAD]: threadFixture("+963955555555"),
      },
      { language: "ar", initialUrl: `/lost-item-case?ticketId=${LOST_TICKET_ID}` },
    );

    expect(await screen.findByTestId("lost-case-status")).toHaveTextContent(
      "تم التواصل مع السائق",
    );
    expect(screen.getByTestId("lost-case-ride")).toHaveTextContent("الراكب Rana", {
      exact: false,
    });
  });

  it("submits feedback with the fixed catalog and submittedAs: driver", async () => {
    const contract = await renderSupportApp(
      {
        [FEEDBACK]: {
          status: 201,
          body: {
            feedbackId: "7e100000-0000-4000-8000-000000000001",
            category: "feature_request",
            body: "Remember my last destinations.",
            submittedAs: "driver",
            createdAt: "2026-10-19T10:00:00Z",
          },
        },
      },
      { initialUrl: "/feedback" },
    );
    await screen.findByTestId("feedback-screen");

    // The whole catalog, i18n-named; no reply is promised up front.
    for (const category of [
      "app_experience",
      "pricing",
      "drivers",
      "safety",
      "feature_request",
      "other",
    ]) {
      expect(screen.getByTestId(`feedback-category-${category}`)).toBeTruthy();
    }
    expect(
      screen.getByText(/we can't reply to each message/i),
    ).toBeTruthy();
    expect(
      screen.getByTestId("feedback-send").props.accessibilityState.disabled,
    ).toBe(true);

    fireEvent.press(screen.getByTestId("feedback-category-feature_request"));
    fireEvent.changeText(
      screen.getByTestId("feedback-body"),
      " Remember my last destinations. ",
    );
    fireEvent.press(screen.getByTestId("feedback-send"));

    expect(await screen.findByTestId("feedback-sent")).toBeTruthy();
    expect(contract.requestsTo(FEEDBACK)[0].body).toEqual({
      category: "feature_request",
      body: "Remember my last destinations.",
      submittedAs: "driver",
    });
  });

  it("maps a feedback 400 to friendly copy and keeps the form", async () => {
    await renderSupportApp(
      { [FEEDBACK]: coded(400, "invalid_category") },
      { initialUrl: "/feedback" },
    );
    await screen.findByTestId("feedback-screen");
    fireEvent.press(screen.getByTestId("feedback-category-other"));
    fireEvent.changeText(screen.getByTestId("feedback-body"), "Hi");
    fireEvent.press(screen.getByTestId("feedback-send"));

    expect(await screen.findByTestId("feedback-error-invalid")).toBeTruthy();
    expect(screen.getByTestId("feedback-body")).toBeTruthy();
  });

  it("renders the feedback catalog in Arabic", async () => {
    await setAppLanguage("ar");
    await renderSupportApp({}, { language: "ar", initialUrl: "/feedback" });
    await screen.findByTestId("feedback-screen");

    expect(screen.getByTestId("feedback-category-feature_request")).toHaveTextContent(
      "اقتراح ميزة",
    );
    expect(screen.getByTestId("feedback-category-safety")).toHaveTextContent("السلامة");
  });

  it("maps the M14 push screens: ticket → the thread, lost_item_case → the case", () => {
    const context = { isDriver: true };
    expect(
      hrefForLink({ screen: "ticket", params: { ticketId: "t-1" } }, context),
    ).toEqual({ pathname: "/ticket", params: { ticketId: "t-1" } });
    expect(
      hrefForLink({ screen: "lost_item_case", params: { ticketId: "t-2" } }, context),
    ).toEqual({ pathname: "/lost-item-case", params: { ticketId: "t-2" } });
    // Without the param (or the driver gate) the center opens instead.
    expect(hrefForLink({ screen: "ticket", params: null }, context)).toBe(
      "/notifications",
    );
    expect(
      hrefForLink(
        { screen: "lost_item_case", params: { ticketId: "t-2" } },
        { isDriver: false },
      ),
    ).toBe("/notifications");
  });
});
