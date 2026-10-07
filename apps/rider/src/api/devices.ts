import { apiFetch } from "./http-client";

/**
 * Client slice of the device-token contract (realtime-v1.yaml `Devices`,
 * ES-03): the native FCM token of this install, registered for the rider
 * audience so pushes reach only the rider app.
 */

export type DevicePlatform = "android" | "ios" | "web";

/** `PUT /api/v1/devices` — register (or move to this account) the token. */
export function registerDevice(
  token: string,
  platform: DevicePlatform,
): Promise<void> {
  return apiFetch<void>("/api/v1/devices", {
    method: "PUT",
    auth: true,
    body: JSON.stringify({ token, platform, app: "rider" }),
  });
}

/** `DELETE /api/v1/devices/{token}` — idempotent; called on logout. */
export function unregisterDevice(token: string): Promise<void> {
  return apiFetch<void>(`/api/v1/devices/${encodeURIComponent(token)}`, {
    method: "DELETE",
    auth: true,
  });
}
