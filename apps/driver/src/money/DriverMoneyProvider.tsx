/**
 * Driver balance / floor facade (COM-02/03, UC-D-16) — the single source of
 * truth for `GET /driver/balance` that the home screen (floor gate), the
 * earnings screen (commission tier) and the balance screen render from.
 *
 * The floor status refreshes WITH the availability data the app already
 * polls/receives (M8-T4): every fresh availability read re-reads the
 * balance, so going (near-)blocked shows up within the same poll window the
 * server uses to stop offers. Quiet failures keep the last known view — the
 * server enforces the floor either way; the app only makes it unmistakable.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getDriverBalance } from "../api/money";
import type {
  DriverBalanceEntry,
  DriverBalanceView,
  FloorStatus,
} from "../api/money-types";
import { useAuth } from "../auth/AuthProvider";
import { failureKindOf } from "../onboarding/server-errors";
import type { FailureKind } from "../onboarding/server-errors";
import { useOptionalAvailability } from "../realtime/AvailabilityProvider";

const STATUS_RANK: Record<FloorStatus, number> = {
  ok: 0,
  warning: 1,
  blocked: 2,
};

/** The worst floor status across the per-currency balances. */
export function worstFloorStatus(view: DriverBalanceView | null): FloorStatus {
  let worst: FloorStatus = "ok";
  for (const entry of view?.balances ?? []) {
    if (STATUS_RANK[entry.status] > STATUS_RANK[worst]) worst = entry.status;
  }
  return worst;
}

/** The entry driving a warning/blocked status (the worst one), or null. */
export function floorAlertEntry(
  view: DriverBalanceView | null,
): DriverBalanceEntry | null {
  let alert: DriverBalanceEntry | null = null;
  for (const entry of view?.balances ?? []) {
    if (
      entry.status !== "ok" &&
      (!alert || STATUS_RANK[entry.status] > STATUS_RANK[alert.status])
    ) {
      alert = entry;
    }
  }
  return alert;
}

export interface DriverMoneyContextValue {
  /** Last loaded balance view (kept through quiet refresh failures). */
  balance: DriverBalanceView | null;
  /** Set when the LAST read failed and nothing is loaded yet. */
  error: FailureKind | null;
  loading: boolean;
  /** Worst status across currencies; `ok` while nothing is loaded. */
  floor: FloorStatus;
  /** The entry behind a warning/blocked floor. */
  alert: DriverBalanceEntry | null;
  reload: () => Promise<void>;
}

const DriverMoneyContext = createContext<DriverMoneyContextValue | null>(null);

export function DriverMoneyProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status: authStatus, isDriver } = useAuth();
  const active = authStatus === "signedIn" && isDriver;
  const availability = useOptionalAvailability();
  // A new object per successful availability read (activation, poll,
  // foreground, toggle) — the balance refresh rides on it.
  const availabilityData =
    availability?.load.status === "loaded" ? availability.load.data : null;

  const [balance, setBalance] = useState<DriverBalanceView | null>(null);
  const [error, setError] = useState<FailureKind | null>(null);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!activeRef.current) return;
    setLoading(true);
    try {
      const view = await getDriverBalance();
      if (mounted.current && activeRef.current) {
        setBalance(view);
        setError(null);
      }
    } catch (caught) {
      // Quiet: keep the last view; only a never-loaded screen shows the error.
      if (mounted.current && activeRef.current) {
        setError(failureKindOf(caught));
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setBalance(null);
      setError(null);
      setLoading(false);
      return;
    }
    void reload();
    // availabilityData: refresh with every availability read (see header).
  }, [active, availabilityData, reload]);

  const value = useMemo<DriverMoneyContextValue>(
    () => ({
      balance,
      error: balance ? null : error,
      loading,
      floor: worstFloorStatus(balance),
      alert: floorAlertEntry(balance),
      reload,
    }),
    [balance, error, loading, reload],
  );

  return (
    <DriverMoneyContext.Provider value={value}>
      {children}
    </DriverMoneyContext.Provider>
  );
}

/** Null without the provider (provider-less unit tests). */
export function useOptionalDriverMoney(): DriverMoneyContextValue | null {
  return useContext(DriverMoneyContext);
}
