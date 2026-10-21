/**
 * V1 conformance W43 (REP-01, UC-S-18; boards V1FDriverTripDetail,
 * V1FDriverTripDetailCancelled, V1FDriverReportPastTrip) against
 * money-v1 / trust-v1 mocks: a past trip's detail from
 * `GET /driver/earnings/rides/{rideId}` — the itemized completed trip, a
 * trip cancelled after acceptance, "Report rider" only while `canReport`
 * (into the existing report flow), the sent report and its outcome once
 * `myReport` is set, and Arabic with Western digits.
 */
import { fireEvent, waitFor } from "@testing-library/react-native";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import type { MockResponse } from "../test-utils/contract";
import {
  BALANCE,
  cancelledNoFeeFixture,
  feeOnlyEarningFixture,
  okBalanceView,
  tripDetailFixture,
  tripDetailRoute,
  tripEarningFixture,
} from "../test-utils/money";
import { renderMoneyScreens } from "../test-utils/money-harness";
import { screen } from "../test-utils/ride-harness";
import { MY_REPORTS, REPORT, reportFixture } from "../test-utils/trust";

const ok = (body: unknown): MockResponse => ({ status: 200, body });

const REPORTED = {
  id: "6c000000-0000-4000-8000-000000000001",
  category: "inappropriate_behavior" as const,
  status: "open" as const,
  createdAt: "2026-10-11T09:00:00Z",
};

async function openTrip(
  trip: ReturnType<typeof tripEarningFixture> | MockResponse[],
  options: {
    language?: "en" | "ar";
    extra?: Record<string, MockResponse | MockResponse[]>;
  } = {},
) {
  const rideId = Array.isArray(trip)
    ? (trip[0].body as { rideId: string }).rideId
    : trip.rideId;
  return renderMoneyScreens(
    {
      [BALANCE]: ok(okBalanceView()),
      [tripDetailRoute(rideId)]: Array.isArray(trip) ? trip : ok(trip),
      ...options.extra,
    },
    {
      initialUrl: `/trip-detail?rideId=${rideId}`,
      language: options.language,
    },
  );
}

describe("trip detail (W43)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("itemizes a completed trip: when, rider, places, fare, commission, tip, balance change", async () => {
    await openTrip(tripEarningFixture());

    expect(await screen.findByTestId("trip-detail-meta")).toHaveTextContent(
      /^Sun 11 Oct · \d\d:\d\d – \d\d:\d\d · Economy · cash$/u,
    );
    expect(screen.getByTestId("trip-detail-rider")).toHaveTextContent(
      "RanaYour rider",
      { exact: false },
    );
    expect(screen.getByTestId("trip-detail-pickup")).toHaveTextContent(
      "Abu Rummaneh",
    );
    expect(screen.getByTestId("trip-detail-destination")).toHaveTextContent(
      "Umayyad Square",
    );
    expect(screen.getByTestId("trip-line-fare")).toHaveTextContent(
      "Fare · you kept the cashSYP 28,000",
    );
    expect(screen.getByTestId("trip-line-commission")).toHaveTextContent(
      "Commission · 25%−SYP 7,000",
    );
    expect(screen.getByTestId("trip-line-tip")).toHaveTextContent(
      "Tip from Rana+SYP 5,000",
    );
    expect(screen.getByTestId("trip-line-net")).toHaveTextContent(
      "Balance change−SYP 2,000",
    );
    expect(screen.queryByTestId("trip-detail-cancelled")).toBeNull();
    expect(screen.queryByTestId("trip-line-fee")).toBeNull();
  });

  it("draws the route map on a completed trip: the trace, a ring at the pickup, a square at the drop-off, framed", async () => {
    await openTrip(tripDetailFixture());

    expect(await screen.findByTestId("trip-detail-map")).toHaveStyle({
      height: 150,
      borderRadius: 16,
    });
    const html: string = screen.getByTestId("trip-detail-map-webview").props
      .source.html;
    // Leaflet order ([lat, lng]); framed to fit, and a picture, not a control.
    expect(html).toContain(
      '"route":[[33.5164,36.2873],[33.5149,36.282],[33.5131,36.2765]]',
    );
    expect(html).toContain(
      '{"id":"pickup","kind":"pickup","position":[33.5164,36.2873]}',
    );
    expect(html).toContain(
      '{"id":"dropoff","kind":"dropoff","position":[33.5131,36.2765]}',
    );
    expect(html).toContain('"fit":true');
    expect(html).toContain('"static":true');
    expect(html).toContain('"route":"#59128A"');
  });

  it("still places the pins when the trace is too short for a line", async () => {
    await openTrip(tripDetailFixture({ route: null }));

    expect(await screen.findByTestId("trip-detail-map")).toBeTruthy();
    const html: string = screen.getByTestId("trip-detail-map-webview").props
      .source.html;
    expect(html).toContain('"route":null');
    expect(html).toContain('"kind":"pickup"');
    expect(html).toContain('"kind":"dropoff"');
  });

  it("no route map when the route and pins are missing", async () => {
    await openTrip(tripEarningFixture());
    expect(await screen.findByTestId("trip-detail-meta")).toBeTruthy();
    expect(screen.queryByTestId("trip-detail-map")).toBeNull();
  });

  it("no route map on a cancelled trip (board V1FDriverTripDetailCancelled)", async () => {
    // Even if a cancelled row carried points, the cancelled board has no map.
    const fixture = tripDetailFixture();
    await openTrip(
      cancelledNoFeeFixture({
        pickup: fixture.pickup,
        destination: fixture.destination,
        route: fixture.route,
      }),
    );
    expect(await screen.findByTestId("trip-detail-cancelled")).toBeTruthy();
    expect(screen.queryByTestId("trip-detail-map")).toBeNull();
  });

  it("offers Report rider while canReport and opens the report flow for this trip", async () => {
    await openTrip(tripEarningFixture());

    expect(await screen.findByTestId("trip-detail-report")).toHaveTextContent(
      "Report rider",
      { exact: false },
    );
    expect(screen.getByTestId("trip-detail-report-privacy")).toHaveTextContent(
      "Rana is not told who reported them.",
    );
    expect(screen.queryByTestId("trip-detail-reported")).toBeNull();

    fireEvent.press(screen.getByTestId("trip-detail-report"));
    expect(await screen.findByTestId("report-rider-screen")).toBeTruthy();
    expect(screen.getByTestId("report-title")).toHaveTextContent("Report Rana");
    expect(screen.getByTestId("report-trip")).toHaveTextContent(
      "· Umayyad Square",
      { exact: false },
    );
  });

  it("after the report is sent, going back shows it on the trip (re-read on focus)", async () => {
    const trip = tripEarningFixture();
    const contract = await openTrip(
      [
        ok(trip),
        ok(tripEarningFixture({ canReport: false, myReport: REPORTED })),
      ],
      {
        extra: {
          [REPORT]: { status: 201, body: reportFixture() },
          [MY_REPORTS]: ok({
            items: [reportFixture()],
            page: 0,
            size: 20,
            totalItems: 1,
            totalPages: 1,
          }),
        },
      },
    );

    fireEvent.press(await screen.findByTestId("trip-detail-report"));
    fireEvent.press(
      await screen.findByTestId("report-category-inappropriate_behavior"),
    );
    fireEvent.press(screen.getByTestId("report-send"));
    expect(await screen.findByTestId("reports-screen")).toBeTruthy();
    expect(contract.requestsTo(REPORT)).toHaveLength(1);

    fireEvent.press(screen.getByTestId("screen-back"));
    expect(await screen.findByTestId("trip-detail-reported")).toBeTruthy();
    expect(screen.queryByTestId("trip-detail-report")).toBeNull();
    expect(contract.requestsTo(tripDetailRoute(trip.rideId))).toHaveLength(2);
  });

  it("a trip cancelled after acceptance: the banner, no fee inside the free window, the sent report", async () => {
    await openTrip(
      cancelledNoFeeFixture({ canReport: false, myReport: REPORTED }),
    );

    expect(await screen.findByTestId("trip-detail-meta")).toHaveTextContent(
      /^Sat 10 Oct · \d\d:\d\d · Economy$/u,
    );
    expect(screen.getByTestId("trip-detail-cancelled")).toHaveTextContent(
      /^Rider cancelled after you accepted · \d\d:\d\d$/u,
    );
    expect(screen.getByTestId("trip-detail-rider")).toHaveTextContent("Hadi", {
      exact: false,
    });
    expect(screen.getByTestId("trip-line-fee")).toHaveTextContent(
      "Cancellation feeNone · inside the free window",
    );
    expect(screen.getByTestId("trip-line-net")).toHaveTextContent(
      "Balance changeSYP 0",
    );
    expect(screen.queryByTestId("trip-line-fare")).toBeNull();
    expect(screen.queryByTestId("trip-line-commission")).toBeNull();

    const reported = screen.getByTestId("trip-detail-reported");
    expect(reported).toHaveTextContent("You reported Hadi", { exact: false });
    expect(reported).toHaveTextContent("Inappropriate behavior · sent 11 Oct", {
      exact: false,
    });
    expect(screen.getByTestId("trip-detail-report-status")).toHaveTextContent(
      "In review",
    );
    expect(screen.queryByTestId("trip-detail-report")).toBeNull();

    fireEvent.press(screen.getByTestId("trip-detail-see-reports"));
    expect(await screen.findByTestId("reports-screen")).toBeTruthy();
  });

  it("a credited cancellation fee, and a charged fee not collected yet", async () => {
    await openTrip(feeOnlyEarningFixture());
    expect(await screen.findByTestId("trip-line-fee")).toHaveTextContent(
      "Cancellation fee+SYP 10,000",
    );
    expect(screen.getByTestId("trip-line-net")).toHaveTextContent(
      "Balance change+SYP 10,000",
    );
    screen.unmount();

    await openTrip(cancelledNoFeeFixture({ cancellationFeeCharged: 10000 }));
    expect(await screen.findByTestId("trip-line-fee")).toHaveTextContent(
      "Cancellation feeSYP 10,000 · not collected yet",
    );
  });

  it("a driver cancellation: its own banner and no free-window claim", async () => {
    await openTrip(cancelledNoFeeFixture({ rideState: "cancelled_by_driver" }));
    expect(
      await screen.findByTestId("trip-detail-cancelled"),
    ).toHaveTextContent(/^You cancelled after accepting · \d\d:\d\d$/u);
    expect(screen.getByTestId("trip-line-fee")).toHaveTextContent(
      "Cancellation feeNone",
    );
    expect(screen.getByTestId("trip-line-fee")).not.toHaveTextContent(
      "free window",
      { exact: false },
    );
  });

  it("no report action when the trip cannot be reported and none was sent", async () => {
    await openTrip(tripEarningFixture({ canReport: false, myReport: null }));
    expect(await screen.findByTestId("trip-line-net")).toBeTruthy();
    expect(screen.queryByTestId("trip-detail-report")).toBeNull();
    expect(screen.queryByTestId("trip-detail-reported")).toBeNull();
  });

  it("shows a failure with retry when the trip cannot be read", async () => {
    const trip = tripEarningFixture();
    await openTrip([{ status: 500, body: { status: 500 } }, ok(trip)]);
    expect(await screen.findByTestId("trip-detail-error")).toBeTruthy();
    fireEvent.press(screen.getByTestId("failure-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("trip-line-net")).toBeTruthy(),
    );
  });

  it("renders in Arabic with Western digits and ل.س", async () => {
    await setAppLanguage("ar");
    await openTrip(tripEarningFixture(), { language: "ar" });

    const meta = await screen.findByTestId("trip-detail-meta");
    expect(meta).toHaveTextContent("اقتصادي", { exact: false });
    expect(meta).toHaveTextContent("نقداً", { exact: false });
    expect(screen.getByTestId("trip-line-fare")).toHaveTextContent(
      "الأجرة · احتفظت بالنقد",
      { exact: false },
    );
    expect(screen.getByTestId("trip-line-net")).toHaveTextContent("ل.س", {
      exact: false,
    });
    expect(screen.getByTestId("trip-detail-report")).toHaveTextContent(
      "الإبلاغ عن الراكب",
      { exact: false },
    );
    expect(screen.getByTestId("trip-detail-screen")).not.toHaveTextContent(
      /[٠-٩]/u,
    );
  });
});
