/**
 * M11-T3 reporting (UC-S-18, REP-01/02) against trust-v1.yaml mocks: the
 * rider → driver category list (never the driver → rider ones), optional
 * text, up to 3 photos uploaded via POST /report-files (400 → JPEG/PNG
 * copy), the report POST with the uploaded ids → "Report sent · Your
 * reports"; 409 report_already_submitted / no_counterpart; the entry
 * points on the receipt and the in-ride safety row; and the reports list
 * with outcome labels only (In review / Action taken / Not confirmed).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { LANGUAGE_STORAGE_KEY, LocaleProvider } from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import { RIDE_ID, receiptFixture, sampleDriver } from "../../../test-utils/ride-fixtures";
import { coded, completedRide, ownReport } from "../../../test-utils/trust-fixtures";
import ReceiptScreen from "../../ride/receipt-screen";
import ReportScreen from "../report-screen";
import ReportsScreen from "../reports-screen";

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
}));

const mockLaunchImageLibraryAsync = jest.fn();
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibraryAsync(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

const RIDE = `GET /api/v1/rides/${RIDE_ID}`;
const FILES = "POST /api/v1/report-files";
const REPORT = `POST /api/v1/rides/${RIDE_ID}/reports`;
const MINE = "GET /api/v1/reports/mine";

function picked(n: number) {
  return {
    canceled: false,
    assets: [
      { uri: `file:///photo-${n}.jpg`, fileName: `photo-${n}.jpg`, mimeType: "image/jpeg" },
    ],
  };
}

function uploaded(n: number) {
  return {
    status: 201,
    body: {
      fileId: `f${n}f${n}f${n}f${n}-0000-4000-8000-00000000000${n}`,
      contentType: "image/jpeg",
      sizeBytes: 1000,
    },
  };
}

function renderReport() {
  return render(
    <LocaleProvider>
      <ReportScreen rideId={RIDE_ID} />
    </LocaleProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
});

describe("report flow (UC-S-18)", () => {
  it("lists the rider → driver categories and needs one before sending", async () => {
    mockApi({ [RIDE]: { status: 200, body: completedRide() } });
    await renderReport();

    expect(await screen.findByText("Report \u2068Samer\u2069")).toBeOnTheScreen();
    expect(screen.getByText(/^Ride .*\u2068Umayyad Square\u2069$/)).toBeOnTheScreen();
    expect(screen.getByText("What happened?")).toBeOnTheScreen();
    for (const label of [
      "Unsafe driving",
      "Inappropriate behavior",
      "Vehicle condition",
      "Other",
    ]) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    // The driver → rider categories never appear here.
    expect(screen.queryByText("Unsafe behavior")).toBeNull();
    expect(screen.queryByText("Vehicle damage")).toBeNull();
    expect(screen.getByText(/\u2068Samer\u2069 is not told who reported them/)).toBeOnTheScreen();

    expect(screen.getByTestId("report-send")).toBeDisabled();
    await fireEvent.press(screen.getByTestId("report-category-vehicle_condition"));
    expect(screen.getByTestId("report-category-vehicle_condition")).toBeChecked();
    expect(screen.getByTestId("report-send")).toBeEnabled();
  });

  it("uploads up to 3 photos and files the report with their ids", async () => {
    mockLaunchImageLibraryAsync
      .mockResolvedValueOnce(picked(1))
      .mockResolvedValueOnce(picked(2))
      .mockResolvedValueOnce(picked(3));
    const api = mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [FILES]: [uploaded(1), uploaded(2), uploaded(3)],
      [REPORT]: { status: 201, body: ownReport() },
    });
    await renderReport();

    await fireEvent.press(await screen.findByTestId("report-category-unsafe_driving"));
    await fireEvent.changeText(
      screen.getByTestId("report-details"),
      " Speeding on the Mezzeh highway. ",
    );
    for (let i = 0; i < 3; i += 1) {
      await fireEvent.press(screen.getByTestId("report-add-photo"));
      await waitFor(() =>
        expect(screen.getAllByTestId("report-photo-remove")).toHaveLength(i + 1),
      );
    }
    // Three is the limit: the add tile is gone.
    expect(screen.queryByTestId("report-add-photo")).toBeNull();
    expect(api.callsTo("POST", "/api/v1/report-files")).toHaveLength(3);
    expect(api.callsTo("POST", "/api/v1/report-files")[0].body).toBeInstanceOf(FormData);

    // Removing one brings the add tile back.
    await fireEvent.press(screen.getAllByTestId("report-photo-remove")[2]);
    expect(screen.getByTestId("report-add-photo")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("report-send"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/reports?sent=1"));
    expect(api.callsTo("POST", `/api/v1/rides/${RIDE_ID}/reports`)[0].body).toEqual({
      category: "unsafe_driving",
      description: "Speeding on the Mezzeh highway.",
      photoFileIds: [uploaded(1).body.fileId, uploaded(2).body.fileId],
    });
  });

  it("drops a photo the server rejects with the JPEG/PNG copy", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValueOnce(picked(1));
    mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [FILES]: { status: 400, body: { status: 400, message: "Not an image" } },
    });
    await renderReport();
    await fireEvent.press(await screen.findByTestId("report-add-photo"));
    expect(await screen.findByTestId("report-photo-error")).toHaveTextContent(
      "Use a JPEG or PNG photo.",
    );
    expect(screen.queryByTestId("report-photo")).toBeNull();
  });

  it("explains 409 report_already_submitted and links to Your reports", async () => {
    mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [REPORT]: coded(409, "report_already_submitted"),
    });
    await renderReport();
    await fireEvent.press(await screen.findByTestId("report-category-other"));
    await fireEvent.press(screen.getByTestId("report-send"));

    expect(await screen.findByTestId("report-blocked")).toHaveTextContent(
      "You've already reported this ride. You can follow it in Your reports.",
    );
    expect(screen.getByTestId("report-send")).toBeDisabled();
    await fireEvent.press(screen.getByTestId("report-view-reports"));
    expect(mockReplace).toHaveBeenCalledWith("/reports");
  });

  it("explains 409 no_counterpart", async () => {
    mockApi({
      [RIDE]: { status: 200, body: completedRide() },
      [REPORT]: coded(409, "no_counterpart"),
    });
    await renderReport();
    await fireEvent.press(await screen.findByTestId("report-category-other"));
    await fireEvent.press(screen.getByTestId("report-send"));
    expect(await screen.findByTestId("report-blocked")).toHaveTextContent(
      "This ride had no driver, so there's no one to report.",
    );
  });

  it("renders the categories in Arabic", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({ [RIDE]: { status: 200, body: completedRide() } });
    await renderReport();
    // W2: the whole title, the name in a first-strong isolate.
    expect(
      await screen.findByText("الإبلاغ عن ⁨Samer⁩"),
    ).toBeOnTheScreen();
    expect(screen.getByText("قيادة غير آمنة")).toBeOnTheScreen();
    expect(screen.getByText("إرسال البلاغ")).toBeOnTheScreen();
  });

  it("is reachable from the receipt", async () => {
    mockApi({
      [`GET /api/v1/rides/${RIDE_ID}/receipt`]: {
        status: 200,
        body: receiptFixture({ driver: sampleDriver }),
      },
    });
    await render(
      <LocaleProvider>
        <ReceiptScreen rideId={RIDE_ID} />
      </LocaleProvider>,
    );
    await fireEvent.press(await screen.findByTestId("receipt-report"));
    expect(mockPush).toHaveBeenCalledWith(`/report/${RIDE_ID}`);
  });
});

describe("Your reports (REP-02 outcome only)", () => {
  function renderReports(justSent = false) {
    return render(
      <LocaleProvider>
        <ReportsScreen justSent={justSent} />
      </LocaleProvider>,
    );
  }

  const page = {
    items: [
      ownReport(),
      ownReport({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        category: "vehicle_condition",
        status: "substantiated",
        createdAt: "2026-10-02T10:00:00Z",
        resolvedAt: "2026-10-04T10:00:00Z",
      }),
      ownReport({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        category: "other",
        status: "unsubstantiated",
        createdAt: "2026-09-21T10:00:00Z",
        resolvedAt: "2026-09-23T10:00:00Z",
      }),
    ],
    page: 0,
    size: 20,
    totalElements: 3,
  };

  it("shows Report sent and the outcome labels, never the internal words", async () => {
    const api = mockApi({ [MINE]: { status: 200, body: page } });
    await renderReports(true);

    expect(await screen.findByTestId("reports-sent")).toHaveTextContent(
      /Report sent.*We'll notify you when it's reviewed\./,
    );
    expect(api.callsTo("GET", "/api/v1/reports/mine")[0].query).toMatchObject({
      as: "rider",
    });
    expect(
      screen.getByTestId("report-status-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"),
    ).toHaveTextContent("In review");
    expect(
      screen.getByTestId("report-status-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"),
    ).toHaveTextContent("Action taken");
    expect(
      screen.getByTestId("report-status-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"),
    ).toHaveTextContent("Not confirmed");
    expect(screen.getByText("Unsafe driving")).toBeOnTheScreen();
    expect(screen.getByText("Vehicle condition")).toBeOnTheScreen();
    expect(screen.getByText(/reviewed Oct 4/)).toBeOnTheScreen();
    expect(screen.getByText(/Details of the action stay private/)).toBeOnTheScreen();
    expect(screen.queryByText(/substantiated/i)).toBeNull();
  });

  it("has no Report sent box when opened from Settings", async () => {
    mockApi({ [MINE]: { status: 200, body: page } });
    await renderReports();
    expect(await screen.findByTestId("reports-list")).toBeOnTheScreen();
    expect(screen.queryByTestId("reports-sent")).toBeNull();
  });

  it("shows the empty state", async () => {
    mockApi({
      [MINE]: { status: 200, body: { items: [], page: 0, size: 20, totalElements: 0 } },
    });
    await renderReports();
    expect(await screen.findByTestId("reports-empty")).toBeOnTheScreen();
  });

  it("renders the labels in Arabic", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({ [MINE]: { status: 200, body: page } });
    await renderReports(true);
    expect(await screen.findByText("تم إرسال البلاغ")).toBeOnTheScreen();
    expect(screen.getByText("قيد المراجعة")).toBeOnTheScreen();
    expect(screen.getByText("تم اتخاذ إجراء")).toBeOnTheScreen();
    expect(screen.getByText("غير مؤكَّد")).toBeOnTheScreen();
  });
});
