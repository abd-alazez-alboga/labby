/**
 * The rider's preferences (UC-R-02 comfort + UC-R-03 matching toggle) for
 * the screens that show them (booking) and the screen that edits them.
 * A save publishes the answer so a booking screen underneath shows the new
 * effect when the rider comes back.
 */
import { useCallback, useEffect, useState } from "react";

import {
  getRiderPreferences,
  type RiderPreferences,
  saveRiderPreferences,
} from "../api/rides";

const listeners = new Set<(preferences: RiderPreferences) => void>();

function publish(preferences: RiderPreferences): void {
  for (const listener of listeners) listener(preferences);
}

export function useRiderPreferences() {
  const [preferences, setPreferences] = useState<RiderPreferences | null>(
    null,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const value = await getRiderPreferences();
      setPreferences(value);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const listener = (value: RiderPreferences) => {
      if (active) setPreferences(value);
    };
    listeners.add(listener);
    getRiderPreferences()
      .then((value) => {
        if (!active) return;
        setPreferences(value);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);

  /** `PUT /rider/preferences`; throws on failure. */
  const save = useCallback(async (next: RiderPreferences) => {
    const saved = await saveRiderPreferences(next);
    publish(saved);
    return saved;
  }, []);

  return { preferences, status, reload, save };
}
