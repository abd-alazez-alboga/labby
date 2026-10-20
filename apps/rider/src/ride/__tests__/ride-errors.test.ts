import { I18n } from "i18n-js";

import { ApiError } from "../../api/http-client";
import { translations } from "../../i18n/translations";
import { rideErrorMessage } from "../ride-errors";

function suspended(reason?: string): ApiError {
  return new ApiError(403, "/api/v1/rides", {
    status: 403,
    message: "Rider suspended",
    code: "rider_suspended",
    ...(reason ? { details: { suspensionReason: reason } } : {}),
  });
}

function translator(locale: "en" | "ar") {
  const i18n = new I18n(translations);
  i18n.locale = locale;
  return (key: string, options?: object) => i18n.t(key, options);
}

describe("rideErrorMessage — suspension reasons (W39)", () => {
  it.each([
    ["low_rating", "Your rider account is suspended (low rating)."],
    ["document_expired", "Your rider account is suspended (expired document)."],
    ["manual", "Your rider account is suspended (Labby team review)."],
  ])("labels %s in English", (reason, message) => {
    expect(rideErrorMessage(suspended(reason), translator("en"))).toBe(message);
  });

  it("labels the reason in Arabic, never the raw enum", () => {
    const message = rideErrorMessage(suspended("low_rating"), translator("ar"));
    expect(message).toBe("حسابك كراكب موقوف (تقييم منخفض).");
    expect(message).not.toMatch(/low_rating/);
  });

  it("falls back to the plain message for a missing or unknown reason", () => {
    expect(rideErrorMessage(suspended(), translator("en"))).toBe(
      "Your rider account is suspended.",
    );
    expect(rideErrorMessage(suspended("unpaid_balance"), translator("ar"))).toBe(
      "حسابك كراكب موقوف.",
    );
  });
});
