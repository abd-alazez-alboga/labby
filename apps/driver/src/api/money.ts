import { authFetch } from "./client";
import type {
  DriverBalanceView,
  EarningsPeriod,
  EarningsSummary,
  TripEarning,
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
 * `GET /driver/earnings/rides/{rideId}` — one trip with the driver's report
 * status (V1 conformance W43); `memberId` names the shared-ride member row.
 * 404 for a ride that is not this driver's past trip.
 */
export function getTripDetail(
  rideId: string,
  memberId: string | null = null,
): Promise<TripEarning> {
  const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : "";
  return authFetch<TripEarning>(
    `/api/v1/driver/earnings/rides/${encodeURIComponent(rideId)}${query}`,
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
