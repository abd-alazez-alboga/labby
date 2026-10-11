/**
 * The rider's saved places (UC-R-01) for screens that offer them as
 * one-tap choices (home, booking, route change) or manage them.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { failureKind, type FailureKind } from "../api/http-client";
import { listSavedLocations, type SavedLocation } from "../api/rides";

export interface SavedPlacesState {
  places: SavedLocation[];
  status: "loading" | "ready" | "error";
  failure: FailureKind | null;
  reload: () => Promise<void>;
  /** Local update after a create / update / delete answered. */
  setPlaces: (update: (places: SavedLocation[]) => SavedLocation[]) => void;
}

export function useSavedPlaces(): SavedPlacesState {
  const [places, setPlacesState] = useState<SavedLocation[]>([]);
  const [status, setStatus] = useState<SavedPlacesState["status"]>("loading");
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const list = await listSavedLocations();
      if (!mounted.current) return;
      setPlacesState(list);
      setStatus("ready");
      setFailure(null);
    } catch (error) {
      if (!mounted.current) return;
      setStatus("error");
      setFailure(failureKind(error));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      await reload();
    })();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const setPlaces = useCallback(
    (update: (list: SavedLocation[]) => SavedLocation[]) =>
      setPlacesState((list) => update(list)),
    [],
  );

  return { places, status, failure, reload, setPlaces };
}
