/**
 * M12-T5 — the driver's trust actions on a SHARED ride against the
 * scheduled-shared-v1 wire (C2): one rating prompt per completed member
 * (`memberId` on GET /ratings/pending, `?memberId=` on the rating), the
 * in-ride "Report a rider" member picker (artboard "Report a rider · pick
 * the member") → the report with `?memberId=`, and the chat push deep link
 * naming the member's thread.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { screen } from "expo-router/testing-library";

import { clearSession } from "../auth/session";
import { initI18n, setAppLanguage } from "../i18n";
import { hrefForLink } from "../notifications/deep-links";
import { availabilityFixture } from "../test-utils/realtime";
import { RIDE_ID } from "../test-utils/rides";
import { LINA, OMAR, RANA, sharedRide } from "../test-utils/scheduled";
import {
  MY_REPORTS,
  ok,
  PENDING,
  pendingFixture,
  RATE,
  REPORT,
  reportFixture,
  renderTrustApp,
} from "../test-utils/trust";
import { clearReported, markReported } from "../trust/reported-members";

const ACTIVE_RIDE = "GET /api/v1/driver/rides/active";
const rateOf = (memberId: string) => `${RATE}?memberId=${memberId}`;
const reportOf = (memberId: string) => `${REPORT}?memberId=${memberId}`;

describe("shared ride: rating and reporting each member (M12)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    clearReported();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("prompts member by member; each rating names its member", async () => {
    const contract = await renderTrustApp({
      "GET /api/v1/driver/availability": ok(availabilityFixture({ online: true })),
      [PENDING]: ok([
        pendingFixture({ memberId: RANA.memberId, counterpartFirstName: "Rana" }),
        pendingFixture({ memberId: OMAR.memberId, counterpartFirstName: "Omar" }),
      ]),
      [rateOf(RANA.memberId)]: { status: 204 },
      [rateOf(OMAR.memberId)]: { status: 204 },
    });

    expect(await screen.findByTestId("rate-title")).toHaveTextContent(
      "How was Rana as a rider?",
    );
    fireEvent.press(screen.getByTestId("rate-star-5"));
    fireEvent.press(screen.getByTestId("rate-submit"));

    // The same ride's next member is asked for right away.
    await waitFor(() =>
      expect(screen.getByTestId("rate-title")).toHaveTextContent(
        "How was Omar as a rider?",
      ),
    );
    fireEvent.press(screen.getByTestId("rate-star-4"));
    fireEvent.press(screen.getByTestId("rate-submit"));

    expect(await screen.findByTestId("home-screen")).toBeTruthy();
    expect(contract.requestsTo(rateOf(RANA.memberId))[0].body).toEqual({
      score: 5,
      comment: null,
    });
    expect(contract.requestsTo(rateOf(OMAR.memberId))[0].body).toEqual({
      score: 4,
      comment: null,
    });
    expect(contract.requestsTo(RATE)).toHaveLength(0);
  });

  it("rates one member from history by ride + memberId", async () => {
    const contract = await renderTrustApp(
      {
        [PENDING]: ok([
          pendingFixture({ memberId: RANA.memberId, counterpartFirstName: "Rana" }),
          pendingFixture({ memberId: OMAR.memberId, counterpartFirstName: "Omar" }),
        ]),
        [rateOf(OMAR.memberId)]: { status: 204 },
      },
      { initialUrl: `/rate-rider?rideId=${RIDE_ID}&memberId=${OMAR.memberId}` },
    );
    // The cold-start prompt may sit on home; the history route shows Omar.
    expect(await screen.findByTestId("rate-title")).toHaveTextContent(
      "How was Omar as a rider?",
    );
    fireEvent.press(screen.getByTestId("rate-star-3"));
    fireEvent.press(screen.getByTestId("rate-submit"));
    await waitFor(() => expect(contract.requestsTo(rateOf(OMAR.memberId))).toHaveLength(1));
  });

  it("in-ride Report a rider picks the member first, then reports with memberId", async () => {
    const absent = { ...LINA, status: "no_show" as const, cancellationFee: 2000 };
    const contract = await renderTrustApp({
      [ACTIVE_RIDE]: ok(sharedRide({ state: "in_progress" }, [RANA, OMAR, absent])),
      [reportOf(OMAR.memberId)]: { status: 201, body: reportFixture() },
      [MY_REPORTS]: ok({ items: [reportFixture()], page: 0, size: 20, totalElements: 1 }),
    });

    expect(screen.queryByTestId("safety-report")).toBeNull();
    const link = await screen.findByTestId("safety-report-member");
    expect(link).toHaveTextContent("Report a rider");
    fireEvent.press(link);

    expect(await screen.findByTestId("report-member-screen")).toBeTruthy();
    expect(screen.getByTestId(`report-member-${RANA.memberId}`)).toHaveTextContent(
      /Rana · created the ride/,
    );
    expect(screen.getByTestId(`report-member-${OMAR.memberId}`)).toHaveTextContent(
      /Party of 1 · on board/,
    );
    expect(screen.getByTestId(`report-member-${LINA.memberId}`)).toHaveTextContent(
      /Party of 1 · marked absent/,
    );

    fireEvent.press(screen.getByTestId(`report-member-${OMAR.memberId}`));
    expect(await screen.findByTestId("report-title")).toHaveTextContent("Report Omar");
    fireEvent.press(screen.getByTestId("report-category-other"));
    fireEvent.press(screen.getByTestId("report-send"));

    expect(await screen.findByTestId("reports-screen")).toBeTruthy();
    expect(contract.requestsTo(reportOf(OMAR.memberId))[0].body).toEqual({
      category: "other",
      description: null,
      photoFileIds: [],
    });
    expect(contract.requestsTo(REPORT)).toHaveLength(0);
  });

  it("a member reported in this session reads Already reported and is not pressable", async () => {
    markReported(RIDE_ID, OMAR.memberId);
    await renderTrustApp(
      { [ACTIVE_RIDE]: ok(sharedRide({ state: "in_progress" })) },
      { initialUrl: `/report-member?rideId=${RIDE_ID}` },
    );
    const row = await screen.findByTestId(`report-member-${OMAR.memberId}`);
    expect(row).toHaveTextContent(/Already reported/);
    fireEvent.press(row);
    expect(screen.queryByTestId("report-rider-screen")).toBeNull();
  });

  it("renders the picker in Arabic", async () => {
    await setAppLanguage("ar");
    await renderTrustApp(
      { [ACTIVE_RIDE]: ok(sharedRide({ state: "in_progress" })) },
      { initialUrl: `/report-member?rideId=${RIDE_ID}`, language: "ar" },
    );
    expect(await screen.findByTestId("report-member-screen")).toBeTruthy();
    expect(screen.getByText("عمّن تريد الإبلاغ؟ كل بلاغ يخص راكباً واحداً، ولا يُخبَر أحد بمن أبلغ عنه.")).toBeTruthy();
    expect(screen.getByTestId(`report-member-${OMAR.memberId}`)).toHaveTextContent(
      /في السيارة/,
    );
  });

  it("a chat push on a shared ride opens that member's thread", () => {
    expect(
      hrefForLink(
        { screen: "chat", params: { rideId: RIDE_ID, memberId: OMAR.memberId } },
        { isDriver: true },
      ),
    ).toEqual({ pathname: "/chat", params: { rideId: RIDE_ID, memberId: OMAR.memberId } });
    expect(
      hrefForLink({ screen: "chat", params: { rideId: RIDE_ID } }, { isDriver: true }),
    ).toEqual({ pathname: "/chat", params: { rideId: RIDE_ID } });
  });
});
