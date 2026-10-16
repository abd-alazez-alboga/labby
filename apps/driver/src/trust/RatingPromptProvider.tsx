/**
 * The post-trip rating prompt facade (UC-S-17, RATE-01) — mounted at the
 * root inside the ride facade; active only for a driver who can drive.
 *
 * - `pending` mirrors `GET /ratings/pending?as=driver` (completed rides still
 *   inside the 7-day window and not rated yet, newest first). The earnings
 *   trip list reads it for the "Rate {name}" entry (A1: a skipped prompt
 *   stays reachable from history until the window closes).
 * - `prompt` is the ride the home route asks the driver to rate:
 *   - right after a ride ends (its earnings breakdown dismissed, or the cash
 *     marked unpaid), when the server lists that ride as pending — a
 *     cancelled ride is never listed, so it never prompts;
 *   - on activation (cold start / sign-in), the newest pending ride the
 *     driver has not skipped before.
 * - Skipping is remembered on the device (best-effort) so a cold start does
 *   not ask again for the same ride; the ride stays rateable from Trips.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { PaymentStatus } from "../api/ride-types";
import { getPendingRatings } from "../api/trust";
import type { PendingRating } from "../api/trust-types";
import { useAuth } from "../auth/AuthProvider";
import { useOptionalDriverRide } from "../rides/DriverRideProvider";

export const RATING_SKIPS_KEY = "labby-driver.rating-skips";
/** Skipped ride ids kept on the device (the window is 7 days anyway). */
const SKIPS_MAX = 50;

/** How the just-finished ride was paid — the prompt's "cash collected" line. */
export type PromptPayment = "cash" | "wallet" | "unpaid";

export interface RatingPrompt {
  target: PendingRating;
  /** Known only for the ride that just ended (not on a cold start). */
  payment: PromptPayment | null;
}

export interface RatingPromptContextValue {
  pending: PendingRating[];
  prompt: RatingPrompt | null;
  /** Re-reads the pending list (history entry, after a rating). */
  refresh: () => Promise<PendingRating[] | null>;
  /** "Skip": closes the prompt; the ride stays rateable from Trips. */
  skip: () => void;
  /** Rated (or no longer rateable): drops the ride from the list and the prompt. */
  finish: (rideId: string) => void;
}

const RatingPromptContext = createContext<RatingPromptContextValue | null>(
  null,
);

function paymentOf(status: PaymentStatus | null | undefined): PromptPayment | null {
  switch (status) {
    case "paid_cash":
    case "paid_mixed":
      return "cash";
    case "paid_wallet":
      return "wallet";
    case "unpaid":
      return "unpaid";
    default:
      return null;
  }
}

async function readSkips(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RATING_SKIPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function rememberSkip(rideId: string): Promise<void> {
  try {
    const skips = (await readSkips()).filter((id) => id !== rideId);
    skips.push(rideId);
    await AsyncStorage.setItem(
      RATING_SKIPS_KEY,
      JSON.stringify(skips.slice(-SKIPS_MAX)),
    );
  } catch {
    // Best-effort: at worst the next cold start asks once more.
  }
}

export function RatingPromptProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status, driverAccess } = useAuth();
  // Ratings are refused on a suspended account — prompt only real drivers.
  const active = status === "signedIn" && driverAccess === "active";
  const rides = useOptionalDriverRide();

  const [pending, setPending] = useState<PendingRating[]>([]);
  const [prompt, setPrompt] = useState<RatingPrompt | null>(null);
  const mounted = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const promptRef = useRef<RatingPrompt | null>(null);
  promptRef.current = prompt;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<PendingRating[] | null> => {
    if (!activeRef.current) return null;
    try {
      const list = await getPendingRatings();
      if (!mounted.current || !activeRef.current) return null;
      setPending(list);
      return list;
    } catch {
      // Quiet: the prompt is a courtesy; history keeps the last list.
      return null;
    }
  }, []);

  // Activation (cold start / sign-in): the newest ride not skipped before.
  useEffect(() => {
    if (!active) {
      setPending([]);
      setPrompt(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [list, skips] = await Promise.all([refresh(), readSkips()]);
      if (cancelled || !list || promptRef.current) return;
      const next = list.find((item) => !skips.includes(item.rideId));
      if (next) setPrompt({ target: next, payment: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [active, refresh]);

  // After a ride: once it (and its earnings breakdown) is gone, ask for
  // the rating if the server lists it as pending (completed rides only).
  const rideId = rides?.ride?.id ?? null;
  const settledId = rides?.settled?.id ?? null;
  const lastRide = useRef<{ id: string; payment: PromptPayment | null } | null>(
    null,
  );
  const latestPayment = paymentOf(
    rides?.settled?.paymentStatus ?? rides?.ride?.paymentStatus,
  );
  useEffect(() => {
    const current = rideId ?? settledId;
    if (current) {
      lastRide.current = { id: current, payment: latestPayment };
      return;
    }
    const ended = lastRide.current;
    lastRide.current = null;
    if (!ended || !activeRef.current) return;
    void refresh().then((list) => {
      const target = list?.find((item) => item.rideId === ended.id);
      // A marked-unpaid ride ends without a breakdown — say so on the prompt.
      const payment =
        ended.payment ?? (rides?.notice === "markedUnpaid" ? "unpaid" : null);
      if (target && mounted.current) setPrompt({ target, payment });
    });
    // rides.notice is read at the moment the ride ended, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, settledId, latestPayment, refresh]);

  const skip = useCallback(() => {
    const current = promptRef.current;
    if (!current) return;
    setPrompt(null);
    void rememberSkip(current.target.rideId);
  }, []);

  const finish = useCallback((rideId: string) => {
    setPending((list) => list.filter((item) => item.rideId !== rideId));
    setPrompt((current) =>
      current && current.target.rideId === rideId ? null : current,
    );
  }, []);

  const value = useMemo<RatingPromptContextValue>(
    () => ({ pending, prompt, refresh, skip, finish }),
    [pending, prompt, refresh, skip, finish],
  );

  return (
    <RatingPromptContext.Provider value={value}>
      {children}
    </RatingPromptContext.Provider>
  );
}

/** Null without the provider (provider-less unit tests of the home screen). */
export function useOptionalRatingPrompt(): RatingPromptContextValue | null {
  return useContext(RatingPromptContext);
}
