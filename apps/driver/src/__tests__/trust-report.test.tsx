/**
 * M11-T3 — UC-S-18 for the driver against trust-v1.yaml mocks: reporting
 * the rider from the rating prompt (driver → rider categories only, text,
 * up to 3 photos uploaded first), the 409 / upload exceptions, and the
 * reports list with the approved outcome labels (never notes).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { mockLibraryPick } from "../test-utils/onboarding";
import { inProgressRide, RIDE_ID } from "../test-utils/rides";
import {
  coded,
  MY_REPORTS,
  ok,
  PENDING,
  pendingFixture,
  REPORT,
  REPORT_FILES,
  reportFixture,
  renderTrustApp,
} from "../test-utils/trust";

function uploadedPhoto(n: number) {
  return ok({
    fileId: `7d000000-0000-4000-8000-00000000000${n}`,
    contentType: "image/jpeg",
    sizeBytes: 2048,
  });
}

const reportPath = `/report-rider?rideId=${RIDE_ID}&name=Rana&when=2026-10-15T09%3A43%3A00Z&place=Umayyad%20Square`;

describe("reporting the rider (UC-S-18)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("opens from the rating prompt's \"Report a problem\" with the ride's rider and place", async () => {
    await renderTrustApp({ [PENDING]: ok([pendingFixture()]) });
    fireEvent.press(await screen.findByTestId("rate-report"));

    expect(await screen.findByTestId("report-rider-screen")).toBeTruthy();
    expect(screen.getByTestId("report-title")).toHaveTextContent("Report Rana");
    expect(screen.getByTestId("report-trip")).toHaveTextContent("· Umayyad Square", {
      exact: false,
    });
  });

  it("offers exactly the driver → rider categories; Send waits for one", async () => {
    await renderTrustApp({}, { initialUrl: reportPath });
    await screen.findByTestId("report-rider-screen");

    for (const [category, label] of [
      ["unsafe_behavior", "Unsafe behavior"],
      ["inappropriate_behavior", "Inappropriate behavior"],
      ["vehicle_damage", "Damage to my vehicle"],
      ["other", "Other"],
    ]) {
      expect(screen.getByTestId(`report-category-${category}`)).toHaveTextContent(label);
    }
    // Rider → driver categories never show here.
    expect(screen.queryByTestId("report-category-unsafe_driving")).toBeNull();
    expect(screen.queryByTestId("report-category-vehicle_condition")).toBeNull();
    expect(screen.getByTestId("report-send").props.accessibilityState.disabled).toBe(true);
    expect(
      screen.getByText("Rana is not told who reported them. We'll notify you of the outcome."),
    ).toBeTruthy();
  });

  it("uploads up to 3 photos first, then files the report → \"Report sent\" + the list", async () => {
    const contract = await renderTrustApp(
      {
        [REPORT_FILES]: [uploadedPhoto(1), uploadedPhoto(2), uploadedPhoto(3)],
        [REPORT]: { status: 201, body: reportFixture() },
        [MY_REPORTS]: ok({ items: [reportFixture()], page: 0, size: 20, totalElements: 1 }),
      },
      { initialUrl: reportPath },
    );
    await screen.findByTestId("report-rider-screen");

    fireEvent.press(screen.getByTestId("report-category-vehicle_damage"));
    expect(
      screen.getByTestId("report-category-vehicle_damage").props.accessibilityState.checked,
    ).toBe(true);
    fireEvent.changeText(
      screen.getByTestId("report-description"),
      " Spilled coffee on the back seat and left. ",
    );

    for (let n = 1; n <= 3; n += 1) {
      mockLibraryPick(`p${n}.jpg`);
      fireEvent.press(screen.getByTestId("report-add-photo"));
      expect(await screen.findByTestId(`report-photo-${n - 1}`)).toBeTruthy();
    }
    // The limit: no add tile after the third photo.
    expect(screen.queryByTestId("report-add-photo")).toBeNull();
    expect(contract.requestsTo(REPORT_FILES)).toHaveLength(3);
    expect(contract.requestsTo(REPORT_FILES)[0].body).toBeInstanceOf(FormData);

    fireEvent.press(screen.getByTestId("report-send"));

    expect(await screen.findByTestId("reports-sent")).toHaveTextContent("Report sent", {
      exact: false,
    });
    expect(contract.requestsTo(REPORT)[0].body).toEqual({
      category: "vehicle_damage",
      description: "Spilled coffee on the back seat and left.",
      photoFileIds: [
        "7d000000-0000-4000-8000-000000000001",
        "7d000000-0000-4000-8000-000000000002",
        "7d000000-0000-4000-8000-000000000003",
      ],
    });
    expect(await screen.findByTestId(`report-status-${reportFixture().id}`)).toHaveTextContent(
      "In review",
    );
  });

  it("a photo can be removed before sending; the add tile comes back below 3", async () => {
    const contract = await renderTrustApp(
      {
        [REPORT_FILES]: [uploadedPhoto(1), uploadedPhoto(2), uploadedPhoto(3)],
        [REPORT]: { status: 201, body: reportFixture() },
        [MY_REPORTS]: ok({ items: [], page: 0, size: 20, totalElements: 0 }),
      },
      { initialUrl: reportPath },
    );
    await screen.findByTestId("report-rider-screen");
    for (let n = 1; n <= 3; n += 1) {
      mockLibraryPick(`p${n}.jpg`);
      fireEvent.press(screen.getByTestId("report-add-photo"));
      expect(await screen.findByTestId(`report-photo-${n - 1}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("report-add-photo")).toBeNull();
    expect(screen.getByTestId("report-photo-remove-1").props.accessibilityLabel).toBe(
      "Remove photo 2",
    );

    fireEvent.press(screen.getByTestId("report-photo-remove-1"));

    expect(screen.queryByTestId("report-photo-2")).toBeNull();
    expect(screen.getByTestId("report-add-photo")).toBeTruthy();
    fireEvent.press(screen.getByTestId("report-category-other"));
    fireEvent.press(screen.getByTestId("report-send"));
    await screen.findByTestId("reports-screen");
    expect(contract.requestsTo(REPORT)[0].body).toMatchObject({
      photoFileIds: [
        "7d000000-0000-4000-8000-000000000001",
        "7d000000-0000-4000-8000-000000000003",
      ],
    });
  });

  it("opens from the in-ride safety actions (\"Report Rana\") during the ride", async () => {
    await renderTrustApp({
      "GET /api/v1/driver/rides/active": ok(inProgressRide()),
    });
    const link = await screen.findByTestId("safety-report");
    expect(link).toHaveTextContent("Report Rana");
    fireEvent.press(link);

    expect(await screen.findByTestId("report-rider-screen")).toBeTruthy();
    expect(screen.getByTestId("report-title")).toHaveTextContent("Report Rana");
    expect(screen.getByTestId("report-trip")).toHaveTextContent("· Umayyad Square", {
      exact: false,
    });
  });

  it("sends no text and no photos as null / [] (only the category is required)", async () => {
    const contract = await renderTrustApp(
      {
        [REPORT]: { status: 201, body: reportFixture({ category: "other" }) },
        [MY_REPORTS]: ok({ items: [], page: 0, size: 20, totalElements: 0 }),
      },
      { initialUrl: reportPath },
    );
    fireEvent.press(await screen.findByTestId("report-category-other"));
    fireEvent.press(screen.getByTestId("report-send"));
    await screen.findByTestId("reports-screen");
    expect(contract.requestsTo(REPORT)[0].body).toEqual({
      category: "other",
      description: null,
      photoFileIds: [],
    });
  });

  it("409 report_already_submitted: one report per ride — explained, Send disabled", async () => {
    await renderTrustApp(
      { [REPORT]: coded(409, "report_already_submitted") },
      { initialUrl: reportPath },
    );
    fireEvent.press(await screen.findByTestId("report-category-unsafe_behavior"));
    fireEvent.press(screen.getByTestId("report-send"));

    expect(await screen.findByTestId("report-error-already")).toHaveTextContent(
      "You've already reported this trip — you'll find it under Your reports.",
    );
    expect(screen.getByTestId("report-send").props.accessibilityState.disabled).toBe(true);
  });

  it("409 no_counterpart and a 413 upload are explained", async () => {
    await renderTrustApp(
      {
        [REPORT_FILES]: { status: 413, body: { status: 413, message: "too large" } },
        [REPORT]: coded(409, "no_counterpart"),
      },
      { initialUrl: reportPath },
    );
    await screen.findByTestId("report-rider-screen");
    mockLibraryPick();
    fireEvent.press(screen.getByTestId("report-add-photo"));
    expect(await screen.findByTestId("report-photo-error")).toHaveTextContent(
      "This file is too large. The maximum size is 10 MB.",
    );
    expect(screen.queryByTestId("report-photo-0")).toBeNull();

    fireEvent.press(screen.getByTestId("report-category-other"));
    fireEvent.press(screen.getByTestId("report-send"));
    expect(await screen.findByTestId("report-error-noCounterpart")).toBeTruthy();
  });

  it("lists reports with the approved outcome labels — never outcome names or notes", async () => {
    await renderTrustApp(
      {
        [MY_REPORTS]: ok({
          items: [
            reportFixture({ id: "r-open", status: "open" }),
            reportFixture({
              id: "r-yes",
              category: "unsafe_behavior",
              status: "substantiated",
              resolvedAt: "2026-10-04T10:00:00Z",
            }),
            reportFixture({
              id: "r-no",
              category: "other",
              status: "unsubstantiated",
              resolvedAt: "2026-09-23T10:00:00Z",
            }),
          ],
          page: 0,
          size: 20,
          totalElements: 3,
        }),
      },
      { initialUrl: "/reports" },
    );

    expect(await screen.findByTestId("report-status-r-open")).toHaveTextContent("In review");
    expect(screen.getByTestId("report-status-r-yes")).toHaveTextContent("Action taken");
    expect(screen.getByTestId("report-status-r-no")).toHaveTextContent("Not confirmed");
    expect(screen.getByTestId("report-row-r-yes")).toHaveTextContent("Unsafe behavior", {
      exact: false,
    });
    expect(screen.getByTestId("report-row-r-yes")).toHaveTextContent("reviewed 4 Oct", {
      exact: false,
    });
    expect(screen.queryByText(/substantiated/i)).toBeNull();
    expect(screen.queryByTestId("reports-sent")).toBeNull();
    expect(screen.queryByTestId("reports-load-more")).toBeNull();
  });

  it("shows the empty state and pages with Show more", async () => {
    const contract = await renderTrustApp(
      {
        [MY_REPORTS]: ok({ items: [reportFixture({ id: "a" })], page: 0, size: 20, totalElements: 2 }),
        "GET /api/v1/reports/mine?as=driver&page=1&size=20": ok({
          items: [reportFixture({ id: "b" })],
          page: 1,
          size: 20,
          totalElements: 2,
        }),
      },
      { initialUrl: "/reports" },
    );
    fireEvent.press(await screen.findByTestId("reports-load-more"));
    expect(await screen.findByTestId("report-row-b")).toBeTruthy();
    expect(screen.getByTestId("report-row-a")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("reports-load-more")).toBeNull());
    expect(contract.requestsTo("GET /api/v1/reports/mine?as=driver&page=1&size=20")).toHaveLength(1);
  });

  it("an empty list says so", async () => {
    await renderTrustApp(
      { [MY_REPORTS]: ok({ items: [], page: 0, size: 20, totalElements: 0 }) },
      { initialUrl: "/reports" },
    );
    expect(await screen.findByTestId("reports-empty")).toHaveTextContent(
      "You haven't sent any reports.",
    );
  });

  it("renders the report form in Arabic", async () => {
    await setAppLanguage("ar");
    await renderTrustApp({}, { initialUrl: reportPath, language: "ar" });
    expect(await screen.findByTestId("report-title")).toHaveTextContent("الإبلاغ عن Rana");
    expect(screen.getByTestId("report-category-vehicle_damage")).toHaveTextContent(
      "ضرر في مركبتي",
    );
    expect(screen.getByTestId("report-send")).toHaveTextContent("إرسال البلاغ");
  });
});
