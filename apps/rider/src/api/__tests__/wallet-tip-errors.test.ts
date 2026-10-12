/**
 * Tip 409 classification (money-v1.yaml): the machine `code` decides; the
 * message wording is only a fallback for a 409 without a known code. Pairs
 * are the backend's real code + message (RideMoneyServiceImpl).
 */
import { ApiError } from "../http-client";
import { tipErrorKey } from "../wallet";

const PATH = "/api/v1/rides/r1/tip";

function conflict(body: { code?: string; message?: string }) {
  return new ApiError(409, PATH, { status: 409, ...body });
}

describe("tipErrorKey", () => {
  it.each([
    ["tip_window_closed", "The tip window for this ride has closed", "windowExpired"],
    ["already_tipped", "This ride already has a tip", "alreadyTipped"],
    ["not_tippable", "This ride cannot be tipped", "notTippable"],
    ["insufficient_balance", "Your wallet balance is not enough for this tip", "insufficientBalance"],
  ])("maps code %s", (code, message, key) => {
    expect(tipErrorKey(conflict({ code, message }))).toBe(key);
  });

  it("trusts the code over misleading wording", () => {
    expect(
      tipErrorKey(conflict({ code: "not_tippable", message: "already closed window" })),
    ).toBe("notTippable");
  });

  it("falls back to the message when no known code is present", () => {
    expect(tipErrorKey(conflict({ message: "The tip window for this ride has closed" }))).toBe(
      "windowExpired",
    );
    expect(tipErrorKey(conflict({ code: "other", message: "This ride already has a tip" }))).toBe(
      "alreadyTipped",
    );
    expect(tipErrorKey(conflict({ message: "Your wallet balance is not enough" }))).toBe(
      "insufficientBalance",
    );
    expect(tipErrorKey(conflict({ message: "Nope" }))).toBe("notTippable");
  });

  it("is generic for non-409 failures", () => {
    expect(tipErrorKey(new ApiError(500, PATH, { status: 500 }))).toBe("generic");
    expect(tipErrorKey(new Error("offline"))).toBe("generic");
  });
});
