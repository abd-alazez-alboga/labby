import AsyncStorage from "@react-native-async-storage/async-storage";

import { ApiError } from "../api/client";
import { commsErrorCode, createShareLink } from "../api/comms";

/**
 * Trip sharing (UC-S-15, SHARE-01): one link per user per ride, whose raw
 * url is served exactly once — in the 201. The url is persisted per ride
 * (AsyncStorage) and reused on every re-tap; a 409 `already_shared` without
 * a stored url (link created before a reinstall) is surfaced as
 * `unavailable`. The links die with the ride, so entries are best-effort
 * and keyed by ride.
 */

const KEY_PREFIX = "labby-driver.share-url.";

export type ShareLinkResult =
  | { kind: "url"; url: string }
  /** The link exists but this device never saw the raw url. */
  | { kind: "unavailable" }
  | { kind: "error" };

async function readStoredUrl(rideId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_PREFIX + rideId);
  } catch {
    return null;
  }
}

async function storeUrl(rideId: string, url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + rideId, url);
  } catch {
    // Best-effort — a lost cache only costs the reuse after a restart.
  }
}

/** The ride's share url: the stored one, or a fresh `POST /share-links`. */
export async function getShareUrl(rideId: string): Promise<ShareLinkResult> {
  const stored = await readStoredUrl(rideId);
  if (stored) return { kind: "url", url: stored };
  try {
    const { url } = await createShareLink(rideId);
    await storeUrl(rideId, url);
    return { kind: "url", url };
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      commsErrorCode(error) === "already_shared"
    ) {
      return { kind: "unavailable" };
    }
    return { kind: "error" };
  }
}
