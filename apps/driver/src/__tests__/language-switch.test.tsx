/**
 * W7 — the one-tap language pill where Settings cannot be reached (boards
 * V1FDriverSignedOutLanguage / …Ar, V1FDriverApplicantLanguage,
 * V1FDriverSuspendedLanguageAr): welcome (device only), the applicant gate
 * and the suspended gate (also saved to the account, like Settings, W14),
 * through the real app routes.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { renderRouter, screen } from "expo-router/testing-library";
import { StyleSheet } from "react-native";

import type { UserProfile } from "../api/auth-types";
import { clearSession, getSession } from "../auth/session";
import i18n, { initI18n, setAppLanguage } from "../i18n";
import { reloadForDirection } from "../i18n/direction-reload";
import {
  driverUser,
  installContractFetch,
  riderOnlyUser,
  seedSession,
} from "../test-utils/contract";
import type { MockResponse } from "../test-utils/contract";

jest.mock("../i18n/direction-reload", () => ({
  reloadForDirection: jest.fn(async () => true),
  takeReturnRoute: jest.fn(async () => null),
}));

const ME = "GET /api/v1/users/me";
const SAVE = "PUT /api/v1/users/me";
const ok = (body: unknown): MockResponse => ({ status: 200, body });

const BASE_ROUTES: Record<string, MockResponse> = {
  "GET /api/v1/meta": ok({ name: "labby-backend", version: "0.1.0" }),
  "GET /api/v1/notifications/unread-count?app=driver": ok({ unread: 0 }),
  "GET /api/v1/driver/offers/open": { status: 204 },
  "GET /api/v1/driver/rides/active": { status: 204 },
};

async function openSignedIn(
  user: UserProfile,
  routes: Record<string, MockResponse | MockResponse[]> = {},
) {
  await seedSession(user);
  const contract = installContractFetch({
    ...BASE_ROUTES,
    [ME]: ok(user),
    ...routes,
  });
  renderRouter("src/app", { initialUrl: "/" });
  return contract;
}

function flexDirectionOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style)
    ?.flexDirection;
}

function lowRatingSuspended(overrides: Partial<UserProfile> = {}) {
  return driverUser({
    name: "Samer",
    roles: [
      { role: "rider", state: "active" },
      { role: "driver", state: "suspended", suspensionReason: "low_rating" },
    ],
    ...overrides,
  });
}

describe("language pill before sign-in and on the gates (W7)", () => {
  beforeEach(async () => {
    jest.mocked(reloadForDirection).mockClear();
    await AsyncStorage.clear();
    await clearSession();
    await initI18n();
    await setAppLanguage("en");
  });

  it("welcome: one tap switches to Arabic on the device, with the direction reload", async () => {
    const contract = installContractFetch(BASE_ROUTES);
    renderRouter("src/app");

    await screen.findByTestId("welcome-screen");
    expect(screen.getByTestId("welcome-brand")).toHaveTextContent("Labby Driver", {
      exact: false,
    });
    expect(screen.getByTestId("language-pill-label")).toHaveTextContent("العربية");
    expect(screen.getByTestId("language-pill").props.accessibilityLabel).toBe(
      "Change language to Arabic",
    );

    fireEvent.press(screen.getByTestId("language-pill"));

    await waitFor(() => expect(reloadForDirection).toHaveBeenCalledTimes(1));
    // Welcome is where the stack lands by itself — no return route stored.
    expect(reloadForDirection).toHaveBeenCalledWith(undefined);
    expect(i18n.language).toBe("ar");
    expect(await AsyncStorage.getItem("labby-driver.language")).toBe("ar");
    expect(await screen.findByText("انطلق مع لبي")).toBeTruthy();
    expect(screen.getByTestId("welcome-brand")).toHaveTextContent("لبي · السائق", {
      exact: false,
    });
    expect(screen.getByTestId("language-pill-label")).toHaveTextContent("English");
    // RTL until the reload applies it natively: rows mirrored by hand.
    expect(flexDirectionOf("welcome-brand")).toBe("row-reverse");
    expect(flexDirectionOf("language-pill")).toBe("row-reverse");
    // Signed out: nothing is saved to an account.
    expect(contract.requestsTo(SAVE)).toHaveLength(0);
  });

  it("welcome keeps Log in and Create account working", async () => {
    installContractFetch(BASE_ROUTES);
    renderRouter("src/app");

    fireEvent.press(await screen.findByTestId("welcome-register"));
    expect(await screen.findByTestId("register-phone")).toBeTruthy();
  });

  it("applicant gate: the pill saves the language to the account before the reload", async () => {
    const user = riderOnlyUser({ name: "Khaled" });
    const contract = await openSignedIn(user, {
      "GET /api/v1/driver/application": { status: 404, body: { status: 404 } },
      [SAVE]: ok({ ...user, language: "ar" }),
    });

    expect(await screen.findByTestId("gate-start")).toBeTruthy();
    expect(screen.getByTestId("gate-user")).toHaveTextContent("Signed in as Khaled");
    expect(screen.getByTestId("gate-intro")).toHaveTextContent("What you'll need", {
      exact: false,
    });
    expect(screen.getByTestId("language-pill-label")).toHaveTextContent("العربية");

    fireEvent.press(screen.getByTestId("language-pill"));

    await waitFor(() => expect(reloadForDirection).toHaveBeenCalledTimes(1));
    expect(contract.requestsTo(SAVE)[0].body).toEqual({
      name: "Khaled",
      language: "ar",
    });
    expect(getSession()?.user.language).toBe("ar");
    expect(i18n.language).toBe("ar");
    expect(screen.getByTestId("gate-title")).toHaveTextContent("كن سائقاً في لبي");
    expect(screen.getByTestId("gate-logout")).toBeTruthy();
  });

  it("still switches on the device when saving to the account fails", async () => {
    const user = riderOnlyUser();
    const contract = await openSignedIn(user, {
      "GET /api/v1/driver/application": { status: 404, body: { status: 404 } },
      [SAVE]: { status: 500, body: { status: 500, message: "down" } },
    });

    fireEvent.press(await screen.findByTestId("language-pill"));

    await waitFor(() => expect(reloadForDirection).toHaveBeenCalledTimes(1));
    expect(contract.requestsTo(SAVE)).toHaveLength(1);
    expect(i18n.language).toBe("ar");
    expect(getSession()?.user.language).toBe("en");
  });

  it("suspended gate in Arabic: reason, riding, earnings and the English pill", async () => {
    await setAppLanguage("ar");
    const user = lowRatingSuspended({ language: "ar" });
    const contract = await openSignedIn(user, {
      [SAVE]: ok({ ...user, language: "en" }),
    });

    expect(await screen.findByTestId("gate-title")).toHaveTextContent(
      "حسابك كسائق موقوف",
    );
    expect(screen.getByTestId("gate-user")).toHaveTextContent(
      "مسجّل الدخول باسم Samer",
    );
    expect(screen.getByTestId("gate-body")).toHaveTextContent(
      "لا يمكنك بدء القيادة أو استلام عروض الرحلات. أرباحك ورصيدك دون تغيير.",
    );
    expect(await screen.findByTestId("gate-reason-text")).toHaveTextContent(
      "انخفض متوسط تقييمك عن الحد الأدنى المسموح به في منطقتك.",
    );
    expect(screen.getByTestId("gate-riding-text")).toHaveTextContent(
      "حسابك كراكب فعّال، ويمكنك حجز الرحلات من تطبيق لبي.",
    );
    expect(screen.getByTestId("gate-view-money")).toHaveTextContent(
      "عرض الأرباح والرصيد",
    );
    expect(screen.getByTestId("gate-logout")).toHaveTextContent("تسجيل الخروج");
    expect(screen.getByTestId("language-pill-label")).toHaveTextContent("English");
    expect(screen.getByTestId("language-pill").props.accessibilityLabel).toBe(
      "تغيير اللغة إلى الإنجليزية",
    );

    expect(flexDirectionOf("language-pill")).toBe("row-reverse");

    fireEvent.press(screen.getByTestId("language-pill"));

    await waitFor(() =>
      expect(contract.requestsTo(SAVE)[0]?.body).toEqual({
        name: "Samer",
        language: "en",
      }),
    );
    expect(i18n.language).toBe("en");
    expect(
      await screen.findByText("Your driver account is suspended"),
    ).toBeTruthy();
    expect(screen.getByTestId("language-pill-label")).toHaveTextContent("العربية");
  });
});
