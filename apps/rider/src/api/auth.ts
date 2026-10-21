/**
 * Typed client for the M2 auth & accounts contract
 * (backend/docs/api/auth-v1.yaml). DTO names and shapes mirror the
 * OpenAPI components 1:1 — the backend is built in parallel against the
 * same document, so this module is the single place the rider app knows
 * about auth endpoints.
 */
import { apiFetch } from "./http-client";

// ---------------------------------------------------------------------------
// Schemas

export type AppLanguage = "en" | "ar";
export type AccountState = "active" | "suspended" | "deleted";
export type RoleName = "rider" | "driver" | "admin";
export type LoginClient = "rider" | "driver" | "admin";

/** Why a role is suspended (USR-04/05/06, auth-v1 + trust-v1, M11). */
export type SuspensionReason = "document_expired" | "low_rating" | "manual";

export interface RoleAssignment {
  role: RoleName;
  state: "active" | "suspended";
  /** Present only while suspended; null for suspensions without a reason. */
  suspensionReason?: SuspensionReason | null;
  /** The admin's reason, shown to the user — `manual` suspensions only (M11). */
  suspensionNote?: string | null;
  /** When the role was suspended — present only while it is (any reason). */
  suspendedAt?: string | null;
}

export interface UserProfile {
  id: string;
  phone: string;
  name: string;
  language: AppLanguage;
  photoUrl?: string | null;
  /** `suspended` = whole-account suspension (M11, USR-06). */
  state: AccountState;
  /** The admin's reason for a whole-account suspension (M11). */
  suspensionNote?: string | null;
  /** When the whole account was suspended; null while it is not. */
  suspendedAt?: string | null;
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
  /** Present only when mode === 'new'. */
  registrationToken?: string | null;
}

export interface RegisterCompleteRequest {
  registrationToken: string;
  password: string;
  name: string;
  /** Must be true; the backend stores the consent timestamp (UC-S-01 step 4). */
  termsAccepted: boolean;
  /**
   * A friend's referral share code (GRW-03 / UC-R-18), captured with the
   * account. Omitted when the rider has none; a refused code answers
   * 404 `referral_code_not_found` or 409 `referral_phone_used` and creates
   * no account.
   */
  referralCode?: string;
}

export interface LoginRequest {
  phone: string;
  password: string;
  client: LoginClient;
}

export interface PasswordResetVerifyResponse {
  resetToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  otpCode: string;
  newPassword: string;
}

export interface UpdateProfileRequest {
  name: string;
  language: AppLanguage;
}

/** Local image selected for the profile photo (React Native file descriptor). */
export interface ProfilePhotoFile {
  uri: string;
  name: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Client-side validation helpers (mirror the contract patterns)

export const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
export const OTP_PATTERN = /^[0-9]{6}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const NAME_MAX_LENGTH = 100;

export function isValidPhone(phone: string): boolean {
  return PHONE_PATTERN.test(phone);
}

/**
 * The canonical (E.164, Syria by default) form of a typed phone number —
 * the same rules as the backend (owner ruling on V1 audit H3), so one
 * handset is one account whichever way it is typed:
 * spaces and dashes are dropped; `09xxxxxxxx` → `+9639xxxxxxxx`;
 * `009639…` and `9639…` → `+9639…`; a `+…` number is kept. Anything else
 * is returned compacted for `isValidPhone` to judge.
 */
export function normalizePhone(input: string): string {
  const compact = input.replace(/[\s-]/g, "");
  if (/^09[0-9]{8}$/.test(compact)) return `+963${compact.slice(1)}`;
  if (compact.startsWith("009639")) return `+${compact.slice(2)}`;
  if (compact.startsWith("9639")) return `+${compact}`;
  return compact;
}

export function isValidOtp(code: string): boolean {
  return OTP_PATTERN.test(code);
}

export function isValidPassword(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH
  );
}

// ---------------------------------------------------------------------------
// Auth endpoints

export function registerStart(phone: string): Promise<void> {
  return apiFetch<void>("/api/v1/auth/register/start", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function registerVerify(
  phone: string,
  code: string,
): Promise<RegisterVerifyResponse> {
  return apiFetch<RegisterVerifyResponse>("/api/v1/auth/register/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export function registerComplete(
  request: RegisterCompleteRequest,
): Promise<AuthTokensResponse> {
  return apiFetch<AuthTokensResponse>("/api/v1/auth/register/complete", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function login(request: LoginRequest): Promise<AuthTokensResponse> {
  return apiFetch<AuthTokensResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function logout(refreshToken: string): Promise<void> {
  return apiFetch<void>("/api/v1/auth/logout", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ refreshToken }),
  });
}

export function passwordResetStart(phone: string): Promise<void> {
  return apiFetch<void>("/api/v1/auth/password-reset/start", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function passwordResetVerify(
  phone: string,
  code: string,
): Promise<PasswordResetVerifyResponse> {
  return apiFetch<PasswordResetVerifyResponse>(
    "/api/v1/auth/password-reset/verify",
    {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    },
  );
}

export function passwordResetComplete(
  resetToken: string,
  newPassword: string,
): Promise<void> {
  return apiFetch<void>("/api/v1/auth/password-reset/complete", {
    method: "POST",
    body: JSON.stringify({ resetToken, newPassword }),
  });
}

// ---------------------------------------------------------------------------
// Me endpoints

export function request2faCode(): Promise<void> {
  return apiFetch<void>("/api/v1/users/me/2fa/request", {
    method: "POST",
    auth: true,
  });
}

export function getMe(): Promise<UserProfile> {
  return apiFetch<UserProfile>("/api/v1/users/me", { auth: true });
}

export function updateProfile(
  request: UpdateProfileRequest,
): Promise<UserProfile> {
  return apiFetch<UserProfile>("/api/v1/users/me", {
    method: "PUT",
    auth: true,
    body: JSON.stringify(request),
  });
}

export function deleteAccount(otpCode: string): Promise<void> {
  return apiFetch<void>("/api/v1/users/me", {
    method: "DELETE",
    auth: true,
    body: JSON.stringify({ otpCode }),
  });
}

export function changePassword(request: ChangePasswordRequest): Promise<void> {
  return apiFetch<void>("/api/v1/users/me/password", {
    method: "PUT",
    auth: true,
    body: JSON.stringify(request),
  });
}

export function phoneChangeStart(newPhone: string): Promise<void> {
  return apiFetch<void>("/api/v1/users/me/phone-change/start", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ newPhone }),
  });
}

export function phoneChangeVerifyCurrent(code: string): Promise<void> {
  return apiFetch<void>("/api/v1/users/me/phone-change/verify-current", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ code }),
  });
}

export function phoneChangeComplete(code: string): Promise<UserProfile> {
  return apiFetch<UserProfile>("/api/v1/users/me/phone-change/complete", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ code }),
  });
}

export function uploadProfilePhoto(
  file: ProfilePhotoFile,
): Promise<UserProfile> {
  const form = new FormData();
  // React Native's FormData accepts a {uri, name, type} file descriptor.
  form.append("file", file as unknown as Blob);
  return apiFetch<UserProfile>("/api/v1/users/me/photo", {
    method: "PUT",
    auth: true,
    body: form,
  });
}
