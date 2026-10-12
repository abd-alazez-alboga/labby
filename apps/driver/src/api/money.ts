import { authFetch } from "./client";
import type {
  DriverBalanceView,
  EarningsPeriod,
  EarningsSummary,
  TripEarningPage,
} from "./money-types";

/**
 * Client slice of money-v1.yaml for the driver (UC-D-15/16): per-trip
 * earnings, period summaries and the balance / floor / commission view.
 */

/** `GET /driver/earnings` — per-trip earnings, newest first, paged. */
export function getTripEarnings(
  page = 0,
  size = 20,
): Promise<TripEarningPage> {
  return authFetch<TripEarningPage>(
    `/api/v1/driver/earnings?page=${page}&size=${size}`,
  );
}

/**
 * `GET /driver/earnings/summary` — the Monday-start week (weekly) or the
 * calendar month (monthly) containing `anchor`.
 */
export function getEarningsSummary(
  period: EarningsPeriod,
  anchor: string,
): Promise<EarningsSummary> {
  return authFetch<EarningsSummary>(
    `/api/v1/driver/earnings/summary?period=${period}&anchor=${anchor}`,
  );
}

/** `GET /driver/balance` — balance per currency, floor status, commission tier. */
export function getDriverBalance(): Promise<DriverBalanceView> {
  return authFetch<DriverBalanceView>("/api/v1/driver/balance");
}
