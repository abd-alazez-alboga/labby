/**
 * Deep-link mapper (UC-S-11): catalog screens → rider routes; unknown → the
 * notification center (contract rule). The rider has no M5 screens (they
 * land on the center); M7's `ride` {rideId} opens the ride screen.
 */
import {
  NOTIFICATION_CENTER_HREF,
  opensNotificationCenter,
  parsePushPayload,
  resolveDeepLink,
} from "../deep-links";

describe("resolveDeepLink", () => {
  it.each([
    ["notifications", undefined],
    ["ride", undefined],
    ["driver_application", undefined],
    ["driver_documents", { documentType: "license" }],
    ["driver_vehicles", undefined],
    ["some_future_screen", { x: "1" }],
    ["toString", undefined],
  ])("maps %s to the notification center", (screen, params) => {
    expect(resolveDeepLink({ screen, params })).toBe(NOTIFICATION_CENTER_HREF);
  });

  it("maps ride {rideId} to the ride screen (rides-v1.yaml push catalog)", () => {
    expect(resolveDeepLink({ screen: "ride", params: { rideId: "9b7c" } })).toBe(
      "/ride/9b7c",
    );
    expect(
      opensNotificationCenter({ screen: "ride", params: { rideId: "9b7c" } }),
    ).toBe(false);
  });

  it("maps a missing link to the center", () => {
    expect(resolveDeepLink(null)).toBe("/notifications");
    expect(resolveDeepLink(undefined)).toBe("/notifications");
    expect(opensNotificationCenter(null)).toBe(true);
  });
});

describe("parsePushPayload", () => {
  it("reads a link object and the notification id", () => {
    expect(
      parsePushPayload({
        notificationId: "n-1",
        link: { screen: "ride", params: { rideId: "r-1" } },
      }),
    ).toEqual({
      notificationId: "n-1",
      link: { screen: "ride", params: { rideId: "r-1" } },
    });
  });

  it("reads a link sent as a JSON string (FCM data values are strings)", () => {
    expect(
      parsePushPayload({ link: JSON.stringify({ screen: "notifications" }) }),
    ).toEqual({ notificationId: null, link: { screen: "notifications" } });
  });

  it("reads flat screen + JSON params", () => {
    expect(
      parsePushPayload({
        screen: "driver_documents",
        params: '{"documentType":"license"}',
      }),
    ).toEqual({
      notificationId: null,
      link: { screen: "driver_documents", params: { documentType: "license" } },
    });
  });

  it('degrades malformed payloads to "no link" (the center opens)', () => {
    expect(parsePushPayload({ link: "{oops" })).toEqual({
      notificationId: null,
      link: null,
    });
    expect(parsePushPayload({ link: { params: {} } })).toEqual({
      notificationId: null,
      link: null,
    });
    expect(parsePushPayload(undefined)).toEqual({
      notificationId: null,
      link: null,
    });
  });
});
