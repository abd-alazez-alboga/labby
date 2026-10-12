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
 * The floor state is the OPERATING region's currency only (the one dispatch
 * checks, W16); a `driver.balance_*` push refreshes it (PushBridge).
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
import { useOptionalRegion } from "../region/RegionProvider";

/** The availability reason dispatch uses for the COM-03 floor. */
export const BALANCE_BELOW_FLOOR = "balance_below_floor";

/**
 * The balance entry the floor gate reads (W16): dispatch checks ONLY the
 * operating region's currency, so the entry in that currency — or, while
 * the region is not resolved, the single entry when there is just one.
 * Other currencies never gate.
 */
export function operatingEntry(
  view: DriverBalanceView | null,
  regionCurrency: string | null,
): DriverBalanceEntry | null {
  const balances = view?.balances ?? [];
  if (regionCurrency) {
    return balances.find((entry) => entry.currency === regionCurrency) ?? null;
  }
  return balances.length === 1 ? balances[0] : null;
}

/**
 * The entry behind a warning/blocked floor, or null. The operating entry's
 * own status leads; when the server says offers are blocked for the floor
 * (online, `offersBlockedReason`) while the operating currency is not known
 * on the device, the blocked entry backs the red card.
 */
export function floorAlertEntry(
  view: DriverBalanceView | null,
  regionCurrency: string | null,
  serverBlocked: boolean,
): DriverBalanceEntry | null {
  const entry = operatingEntry(view, regionCurrency);
  if (serverBlocked && !regionCurrency && entry?.status !== "blocked") {
    const blocked = view?.balances.find((item) => item.status === "blocked");
    if (blocked) return blocked;
  }
  return entry && entry.status !== "ok" ? entry : null;
}

export interface DriverMoneyContextValue {
  /** Last loaded balance view (kept through quiet refresh failures). */
  balance: DriverBalanceView | null;
  /** Set when the LAST read failed and nothing is loaded yet. */
  error: FailureKind | null;
  loading: boolean;
  /**
   * The operating currency's floor status (W16) — `ok` while nothing is
   * loaded. `blocked` stops offers only: going online stays allowed
   * (UC-D-04 E2).
   */
  floor: FloorStatus;
  /** The entry behind a warning/blocked floor. */
  alert: DriverBalanceEntry | null;
  /** The operating currency's entry (see `operatingEntry`), or null. */
  entry: DriverBalanceEntry | null;
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
  const serverBlocked =
    !!availabilityData?.online &&
    availabilityData.offersBlockedReason === BALANCE_BELOW_FLOOR;
  const regionCurrency = useOptionalRegion()?.config?.currency ?? null;

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

  const value = useMemo<DriverMoneyContextValue>(() => {
    const alert = floorAlertEntry(balance, regionCurrency, serverBlocked);
    return {
      balance,
      error: balance ? null : error,
      loading,
      floor: alert?.status ?? "ok",
      alert,
      entry: operatingEntry(balance, regionCurrency),
      reload,
    };
  }, [balance, error, loading, regionCurrency, serverBlocked, reload]);

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
