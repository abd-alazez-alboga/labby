/**
 * Types mirroring the M2 auth contract: backend/docs/api/auth-v1.yaml.
 * Kept free of imports so both the API layer and the session store can
 * depend on them without cycles.
 */

export type AppLanguage = "en" | "ar";

export type RoleName = "rider" | "driver" | "admin";
export type RoleState = "active" | "suspended";
export type AccountState = "active" | "suspended" | "deleted";

/**
 * Why a role is suspended (USR-04): M5 `document_expired` (DRV-04); M11
 * `low_rating` (USR-05, automatic) and `manual` (USR-06, with a note).
 */
export type SuspensionReason = "document_expired" | "low_rating" | "manual";

export interface RoleAssignment {
  role: RoleName;
  state: RoleState;
  /** Present only while suspended; null for suspensions without a recorded reason. */
  suspensionReason?: SuspensionReason | null;
  /** M11: the admin's reason, shown to the user — `manual` suspensions only. */
  suspensionNote?: string | null;
}

export interface UserProfile {
  id: string;
  phone: string;
  name: string;
  language: AppLanguage;
  photoUrl?: string | null;
  /**
   * M11: `suspended` = whole-account suspension (USR-06): every rider and
   * driver feature answers 403 `account_suspended`; login still works.
   */
  state: AccountState;
  /** M11: the admin's reason for a whole-account suspension. */
  suspensionNote?: string | null;
  roles: RoleAssignment[];
}

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: UserProfile;
}

export type RegisterVerifyMode = "new" | "reactivated";

export interface RegisterVerifyResponse {
  mode: RegisterVerifyMode;
  /** Present only when mode = `new`. */
  registrationToken?: string | null;
}

export interface PasswordResetVerifyResponse {
  resetToken: string;
}

/** Client identifier the login endpoint expects — this app is the driver one. */
export const DRIVER_CLIENT = "driver" as const;

/** Contract validation patterns (components.schemas in auth-v1.yaml). */
export const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
export const OTP_PATTERN = /^[0-9]{6}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

/** AUTH-04: seconds a user must wait before requesting another OTP. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** The account's `driver` role assignment, if any. */
export function driverRoleOf(user: UserProfile): RoleAssignment | null {
  return user.roles.find((assignment) => assignment.role === "driver") ?? null;
}

/**
 * True when the profile holds an ACTIVE `driver` role on an account that is
 * not suspended as a whole (the in-app gate; M11 adds the account state).
 */
export function hasActiveDriverRole(user: UserProfile): boolean {
  return (
    user.state !== "suspended" &&
    user.roles.some(
      (assignment) =>
        assignment.role === "driver" && assignment.state === "active",
    )
  );
}

/**
 * How the account may use the driver side (M11):
 * - `active` — drives (the in-app gate);
 * - `roleSuspended` — the driver role is suspended (any reason), the account
 *   itself is not: earnings, balance and performance stay readable;
 * - `accountSuspended` — the whole account is suspended (USR-06): every
 *   driver feature is refused (403 `account_suspended`);
 * - `none` — no driver role (applicant / rider-only account — whose account
 *   suspension, if any, the gate reads from `state`).
 */
export type DriverAccess = "active" | "roleSuspended" | "accountSuspended" | "none";

export function driverAccessOf(user: UserProfile): DriverAccess {
  const role = driverRoleOf(user);
  if (!role) return "none";
  if (user.state === "suspended") return "accountSuspended";
  return role.state === "active" ? "active" : "roleSuspended";
}

/** The rider role is active AND the account is not suspended ("riding still works"). */
export function canRide(user: UserProfile): boolean {
  return (
    user.state !== "suspended" &&
    user.roles.some(
      (assignment) => assignment.role === "rider" && assignment.state === "active",
    )
  );
}
