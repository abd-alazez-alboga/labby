/**
 * Applying a new layout direction. `I18nManager.forceRTL` only takes full
 * effect when the React host restarts, and the window in between is not
 * reliably mirrorable by hand on React Native 0.86 (owner decision
 * 2026-10-07: reload on a direction-changing language switch). The app
 * reloads in place and returns to the screen the switch happened on.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { reloadAppAsync } from "expo";

const RETURN_ROUTE_KEY = "labby.reload.returnTo";

/** Reloads the app so the native layout picks up the new direction. */
export async function reloadForDirection(returnTo?: string): Promise<boolean> {
  try {
    if (returnTo) {
      await AsyncStorage.setItem(RETURN_ROUTE_KEY, returnTo);
    }
    await reloadAppAsync("language direction changed");
    return true;
  } catch {
    // Reload unavailable (tests, unusual hosts): the manual-flip fallback in
    // the locale context keeps the screen usable until the next launch.
    return false;
  }
}

/** The one-shot route to reopen after a direction reload, if any. */
export async function takeReturnRoute(): Promise<string | null> {
  try {
    const route = await AsyncStorage.getItem(RETURN_ROUTE_KEY);
    if (route) {
      await AsyncStorage.removeItem(RETURN_ROUTE_KEY);
    }
    return route;
  } catch {
    return null;
  }
}
