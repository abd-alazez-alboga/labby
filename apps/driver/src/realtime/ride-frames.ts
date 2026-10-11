import type { Ride, RideFrame, RideOffer } from "../api/ride-types";

/**
 * The ride / offer frame dispatcher's parser (rides-v1.yaml "Realtime
 * events"): turns a raw server frame into a typed {@link RideFrame} for THIS
 * app, or null. Every ride / offer frame carries `"as": "rider" | "driver"`
 * — one account can hold both roles with both apps connected — so frames
 * not addressed to the driver are dropped here, as are unknown types and
 * malformed payloads. `ride.driver_position` is rider-only and ignored.
 */
export function parseDriverRideFrame(
  raw: Record<string, unknown>,
): RideFrame | null {
  if (raw.as !== "driver") return null;
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const isString = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0;

  switch (raw.type) {
    case "offer.new":
      return isObject(raw.offer) &&
        isString(raw.offer.id) &&
        isString(raw.offer.expiresAt)
        ? { type: "offer.new", offer: raw.offer as unknown as RideOffer }
        : null;
    case "offer.withdrawn":
      return isString(raw.offerId)
        ? {
            type: "offer.withdrawn",
            offerId: raw.offerId,
            rideId: isString(raw.rideId) ? raw.rideId : "",
            reason: isString(raw.reason) ? raw.reason : "timeout",
          }
        : null;
    case "ride.state":
      return isObject(raw.ride) && isString(raw.ride.id)
        ? { type: "ride.state", ride: raw.ride as unknown as Ride }
        : null;
    case "ride.updated":
      return isObject(raw.ride) && isString(raw.ride.id)
        ? {
            type: "ride.updated",
            reason: isString(raw.reason) ? raw.reason : "",
            ride: raw.ride as unknown as Ride,
          }
        : null;
    case "ride.connection":
      return isString(raw.rideId) &&
        (raw.driverStream === "ok" || raw.driverStream === "lost")
        ? {
            type: "ride.connection",
            rideId: raw.rideId,
            driverStream: raw.driverStream,
          }
        : null;
    default:
      return null;
  }
}
