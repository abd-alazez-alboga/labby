/**
 * The rider's suspension state (M11, auth-v1 + trust-v1 USR-04..06),
 * derived from the profile — or, before a fresh profile arrived, from the
 * 403 code a call met:
 *
 * - `account` — whole-account suspension (`UserProfile.state = suspended`,
 *   USR-06 "deactivate"): the admin's note is shown;
 * - `role` — the rider role is suspended: `low_rating` shows the rating
 *   rule, `manual` the admin's note.
 *
 * The account level wins when both apply. SOS and finishing an in-flight
 * ride stay available (owner ruling 2026-10-15) — callers show the ride,
 * not this state, while one is in flight.
 */
import type { SuspensionReason, UserProfile } from "../api/auth";
import { useOptionalAuth } from "../auth/auth-context";
import type { SuspensionCode } from "../auth/suspension-signal";

export interface RiderSuspension {
  scope: "account" | "role";
  reason: SuspensionReason | null;
  /** The admin's reason (manual suspensions), else null. */
  note: string | null;
  /** When it started (auth-v1 `suspendedAt`), null when unknown. */
  suspendedAt: string | null;
}

export function riderSuspension(
  user: UserProfile | null,
  signal: SuspensionCode | null = null,
): RiderSuspension | null {
  if (user?.state === "suspended") {
    return {
      scope: "account",
      reason: "manual",
      note: user.suspensionNote?.trim() || null,
      suspendedAt: user.suspendedAt ?? null,
    };
  }
  const role = user?.roles.find((assignment) => assignment.role === "rider");
  if (role?.state === "suspended") {
    return {
      scope: "role",
      reason: role.suspensionReason ?? null,
      note:
        role.suspensionReason === "manual"
          ? role.suspensionNote?.trim() || null
          : null,
      suspendedAt: role.suspendedAt ?? null,
    };
  }
  if (signal === "account_suspended") {
    return { scope: "account", reason: null, note: null, suspendedAt: null };
  }
  if (signal === "rider_suspended") {
    return { scope: "role", reason: null, note: null, suspendedAt: null };
  }
  return null;
}

/**
 * True while the WHOLE account is suspended (profile state, or a 403
 * `account_suspended` met since the last profile read). Rating and
 * reporting are refused then, so the app does not offer them; a role-only
 * rider suspension keeps both (the backend still accepts them).
 */
export function isAccountSuspended(
  user: UserProfile | null,
  signal: SuspensionCode | null = null,
): boolean {
  return riderSuspension(user, signal)?.scope === "account";
}

export function useAccountSuspended(): boolean {
  const auth = useOptionalAuth();
  return isAccountSuspended(auth?.user ?? null, auth?.suspensionSignal ?? null);
}
