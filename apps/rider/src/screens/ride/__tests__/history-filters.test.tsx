/**
 * V1 audit W41 (UC-R-16 "list with filters") — approved artboards
 * V1FRiderHistoryFilters (+Ar), V1FRiderHistoryDates, V1FRiderHistoryEmpty:
 * the five filter chips map onto `GET /rides` `state` / `kind`, the "Dates"
 * sheet onto inclusive `from` / `to` days, the summary line names what is
 * shown, rows carry their kind, and a filtered page with no rides offers
 * "Clear filters".
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";

import type { RideSummary } from "../../../api/rides";
import {
  LANGUAGE_STORAGE_KEY,
  LocaleProvider,
} from "../../../i18n/locale-context";
import { mockApi, seedSignedInSession } from "../../../test-utils/mock-api";
import {
  destinationPlace,
  pickupPlace,
} from "../../../test-utils/ride-fixtures";
import RideHistoryScreen from "../ride-history-screen";

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
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secureStoreMock = require("expo-secure-store") as { __reset: () => void };

// 19 Oct 2026, 10:00 device time.
const NOW = new Date(2026, 9, 19, 10, 0);
const RIDES = "/api/v1/rides";

function summary(
  id: string,
  overrides: Partial<RideSummary> = {},
): RideSummary {
  return {
    id,
    state: "completed",
    requestedAt: "2026-10-08T09:29:00Z",
    pickup: pickupPlace,
    destination: destinationPlace,
    serviceTypeNameEn: "Economy",
    serviceTypeNameAr: "اقتصادية",
    total: 27250,
    cancellationFee: null,
    currency: "SYP",
    kind: "on_demand",
    partySize: null,
    myRating: { state: "not_applicable", windowEndsAt: null, score: null },
    counterpartFirstName: null,
    cancellationReason: null,
    ...overrides,
  };
}

function page(items: RideSummary[]) {
  return {
    status: 200,
    body: { items, page: 0, size: 20, totalItems: items.length },
  };
}

const rows = [
  summary("r-ondemand"),
  summary("r-shared-1", { kind: "shared", partySize: 1, total: 9500 }),
  summary("r-shared-2", { kind: "shared", partySize: 2, total: 19000 }),
  summary("r-sched-done", { kind: "scheduled", total: 64000 }),
  summary("r-sched-next", {
    kind: "scheduled",
    state: "scheduled",
    total: null,
    myRating: null,
  }),
  summary("r-cancel", {
    state: "cancelled_by_rider",
    total: null,
    cancellationFee: 2000,
  }),
  summary("r-none", { state: "no_driver_found", total: null }),
];

function renderHistory() {
  return render(
    <LocaleProvider>
      <RideHistoryScreen />
    </LocaleProvider>,
  );
}

function lastQuery(api: ReturnType<typeof mockApi>) {
  const calls = api.callsTo("GET", RIDES);
  return calls[calls.length - 1]?.query;
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      "nextTick",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
      "queueMicrotask",
      "hrtime",
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
    ],
  });
  secureStoreMock.__reset();
  await AsyncStorage.clear();
  await seedSignedInSession();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("history filter chips (V1FRiderHistoryFilters)", () => {
  it("starts on All with no filter and maps each chip onto state / kind", async () => {
    const api = mockApi({ [`GET ${RIDES}`]: page(rows) });
    await renderHistory();

    expect(await screen.findByTestId("history-summary")).toHaveTextContent(
      "All rides · any date",
    );
    expect(lastQuery(api)).toEqual({ page: "0", size: "20" });
    expect(screen.getByTestId("history-header")).toHaveTextContent(
      /Your rides/,
    );
    for (const [chip, label] of [
      ["all", "All"],
      ["completed", "Completed"],
      ["cancelled", "Cancelled"],
      ["scheduled", "Scheduled"],
      ["shared", "Shared"],
    ]) {
      expect(screen.getByTestId(`history-filter-${chip}`)).toHaveTextContent(
        label,
      );
    }
    expect(
      screen.getByTestId("history-filter-all").props.accessibilityState,
    ).toMatchObject({ selected: true });

    const cases = [
      ["completed", { state: "completed" }, "Completed rides · any date"],
      ["cancelled", { state: "cancelled" }, "Cancelled rides · any date"],
      ["scheduled", { kind: "scheduled" }, "Scheduled rides · any date"],
      ["shared", { kind: "shared" }, "Shared rides · any date"],
    ] as const;
    for (const [chip, params, line] of cases) {
      await fireEvent.press(screen.getByTestId(`history-filter-${chip}`));
      await waitFor(() =>
        expect(lastQuery(api)).toEqual({ page: "0", size: "20", ...params }),
      );
      expect(await screen.findByTestId("history-summary")).toHaveTextContent(
        line,
      );
      expect(
        screen.getByTestId(`history-filter-${chip}`).props.accessibilityState,
      ).toMatchObject({ selected: true });
    }

    await fireEvent.press(screen.getByTestId("history-header-back"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("labels each row with its kind and badges an upcoming scheduled ride", async () => {
    mockApi({ [`GET ${RIDES}`]: page(rows) });
    await renderHistory();

    expect(await screen.findByTestId("history-r-ondemand")).toHaveTextContent(
      /· Economy/,
    );
    expect(screen.getByTestId("history-r-shared-1")).toHaveTextContent(
      /· Shared · 1 seat/,
    );
    expect(screen.getByTestId("history-r-shared-2")).toHaveTextContent(
      /· Shared · 2 seats/,
    );
    expect(screen.getByTestId("history-r-sched-done")).toHaveTextContent(
      /· Scheduled · Economy/,
    );
    expect(screen.getByTestId("history-r-sched-next")).toHaveTextContent(
      /· Scheduled · Economy/,
    );
    expect(screen.getByTestId("history-badge-r-sched-next")).toHaveTextContent(
      "Scheduled",
    );
    expect(screen.getByTestId("history-r-cancel")).toHaveTextContent(
      /Cancelled by you/,
    );
    expect(screen.getAllByTestId("icon-people-outline")).toHaveLength(2);
    expect(screen.getAllByTestId("icon-time-outline")).toHaveLength(2);
    expect(screen.getByTestId("icon-close")).toBeOnTheScreen();
    expect(screen.getByTestId("icon-search")).toBeOnTheScreen();
  });

  it("asks for the next page with the same filter", async () => {
    const api = mockApi({
      [`GET ${RIDES}`]: [
        page(rows),
        {
          status: 200,
          body: { items: rows.slice(0, 2), page: 0, size: 20, totalItems: 30 },
        },
        page([]),
      ],
    });
    await renderHistory();
    await screen.findByTestId("history-summary");
    await fireEvent.press(screen.getByTestId("history-filter-completed"));
    await fireEvent.press(await screen.findByTestId("history-load-more"));
    await waitFor(() =>
      expect(lastQuery(api)).toEqual({
        page: "1",
        size: "20",
        state: "completed",
      }),
    );
  });
});

describe("history date range (V1FRiderHistoryDates)", () => {
  it("sends inclusive from / to days and clears them from the header", async () => {
    const api = mockApi({ [`GET ${RIDES}`]: page(rows) });
    await renderHistory();
    await screen.findByTestId("history-summary");

    await fireEvent.press(screen.getByTestId("history-dates"));
    expect(await screen.findByText("Show rides between")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Both days are included. Leave a date empty for no limit.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("history-dates-from-value")).toHaveTextContent(
      "Any date",
    );

    // From: today, stepped back to Oct 1.
    await fireEvent.press(screen.getByTestId("history-dates-from"));
    expect(screen.getByTestId("history-dates-from-value")).toHaveTextContent(
      "Oct 19, 2026",
    );
    for (let i = 0; i < 18; i += 1) {
      await fireEvent.press(screen.getByTestId("history-dates-prev"));
    }
    expect(screen.getByTestId("history-dates-day")).toHaveTextContent(
      "Oct 1, 2026",
    );
    // To: today, stepped back to Oct 5.
    await fireEvent.press(screen.getByTestId("history-dates-to"));
    for (let i = 0; i < 14; i += 1) {
      await fireEvent.press(screen.getByTestId("history-dates-prev"));
    }
    expect(screen.getByTestId("history-dates-to-value")).toHaveTextContent(
      "Oct 5, 2026",
    );
    await fireEvent.press(screen.getByTestId("history-dates-apply"));

    await waitFor(() =>
      expect(lastQuery(api)).toEqual({
        page: "0",
        size: "20",
        from: "2026-10-01",
        to: "2026-10-05",
      }),
    );
    expect(screen.getByTestId("history-dates")).toHaveTextContent(
      /Oct 1\s*–\s*5/,
    );
    expect(await screen.findByTestId("history-summary")).toHaveTextContent(
      /All rides · Oct 1\s*–\s*5/,
    );

    await fireEvent.press(screen.getByLabelText("Clear dates"));
    await waitFor(() =>
      expect(lastQuery(api)).toEqual({ page: "0", size: "20" }),
    );
    expect(screen.getByTestId("history-dates")).toHaveTextContent(/Dates$/);
  });

  it("keeps From on or before To", async () => {
    const api = mockApi({ [`GET ${RIDES}`]: page(rows) });
    await renderHistory();
    await screen.findByTestId("history-summary");
    await fireEvent.press(screen.getByTestId("history-dates"));

    await fireEvent.press(await screen.findByTestId("history-dates-to"));
    await fireEvent.press(screen.getByTestId("history-dates-from"));
    // From moves past To: To follows.
    await fireEvent.press(screen.getByTestId("history-dates-next"));
    expect(screen.getByTestId("history-dates-to-value")).toHaveTextContent(
      "Oct 20, 2026",
    );
    await fireEvent.press(screen.getByTestId("history-dates-apply"));
    await waitFor(() =>
      expect(lastQuery(api)).toMatchObject({
        from: "2026-10-20",
        to: "2026-10-20",
      }),
    );
  });

  it("an open-ended range sends only its set side; Clear dates in the sheet drops it", async () => {
    const api = mockApi({ [`GET ${RIDES}`]: page(rows) });
    await renderHistory();
    await screen.findByTestId("history-summary");

    await fireEvent.press(screen.getByTestId("history-dates"));
    await fireEvent.press(await screen.findByTestId("history-dates-from"));
    await fireEvent.press(screen.getByTestId("history-dates-apply"));
    await waitFor(() =>
      expect(lastQuery(api)).toEqual({
        page: "0",
        size: "20",
        from: "2026-10-19",
      }),
    );
    expect(screen.getByTestId("history-dates")).toHaveTextContent(
      /From Oct 19$/,
    );

    await fireEvent.press(screen.getByTestId("history-dates"));
    await fireEvent.press(
      await screen.findByTestId("history-dates-sheet-clear"),
    );
    await waitFor(() =>
      expect(lastQuery(api)).toEqual({ page: "0", size: "20" }),
    );
  });
});

describe("filtered history without rides (V1FRiderHistoryEmpty)", () => {
  it("names the filter and the dates, and Clear filters resets both", async () => {
    const api = mockApi({
      [`GET ${RIDES}`]: [page(rows), page([]), page([]), page(rows)],
    });
    await renderHistory();
    await screen.findByTestId("history-summary");

    await fireEvent.press(screen.getByTestId("history-filter-cancelled"));
    expect(await screen.findByTestId("history-no-match")).toHaveTextContent(
      /No cancelled rides/,
    );
    expect(
      screen.getByText(
        "You have no cancelled rides. Try another filter or other dates.",
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("history-dates"));
    await fireEvent.press(await screen.findByTestId("history-dates-from"));
    for (let i = 0; i < 18; i += 1) {
      await fireEvent.press(screen.getByTestId("history-dates-prev"));
    }
    await fireEvent.press(screen.getByTestId("history-dates-to"));
    for (let i = 0; i < 14; i += 1) {
      await fireEvent.press(screen.getByTestId("history-dates-prev"));
    }
    await fireEvent.press(screen.getByTestId("history-dates-apply"));
    expect(
      await screen.findByText(
        "You have no cancelled rides from Oct 1 to Oct 5. Try another filter or other dates.",
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("history-clear-filters"));
    await waitFor(() =>
      expect(lastQuery(api)).toEqual({ page: "0", size: "20" }),
    );
    expect(await screen.findByTestId("history-summary")).toHaveTextContent(
      "All rides · any date",
    );
    expect(screen.queryByTestId("history-no-match")).toBeNull();
  });

  it("an unfiltered empty history keeps the first-ride empty state", async () => {
    mockApi({ [`GET ${RIDES}`]: page([]) });
    await renderHistory();
    expect(await screen.findByText("No rides yet")).toBeOnTheScreen();
    expect(screen.queryByTestId("history-no-match")).toBeNull();
  });
});

describe("history filters in Arabic (V1FRiderHistoryFiltersAr)", () => {
  it("renders the Arabic chips, summary, kinds and seat forms", async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    mockApi({
      [`GET ${RIDES}`]: page([
        ...rows,
        summary("r-shared-5", { kind: "shared", partySize: 5 }),
        summary("r-shared-11", { kind: "shared", partySize: 11 }),
      ]),
    });
    await renderHistory();

    expect(await screen.findByTestId("history-summary")).toHaveTextContent(
      "كل الرحلات · أي تاريخ",
    );
    for (const [chip, label] of [
      ["all", "الكل"],
      ["completed", "مكتملة"],
      ["cancelled", "ملغاة"],
      ["scheduled", "مجدولة"],
      ["shared", "مشتركة"],
    ]) {
      expect(screen.getByTestId(`history-filter-${chip}`)).toHaveTextContent(
        label,
      );
    }
    expect(screen.getByTestId("history-dates")).toHaveTextContent(/التاريخ$/);
    expect(screen.getByTestId("history-r-shared-1")).toHaveTextContent(
      /· مشتركة · مقعد واحد/,
    );
    expect(screen.getByTestId("history-r-shared-2")).toHaveTextContent(
      /· مشتركة · مقعدان/,
    );
    expect(screen.getByTestId("history-r-shared-5")).toHaveTextContent(
      /· مشتركة · 5 مقاعد/,
    );
    expect(screen.getByTestId("history-r-shared-11")).toHaveTextContent(
      /· مشتركة · 11 مقعدًا/,
    );
    expect(screen.getByTestId("history-badge-r-sched-next")).toHaveTextContent(
      "مجدولة",
    );
  });
});
