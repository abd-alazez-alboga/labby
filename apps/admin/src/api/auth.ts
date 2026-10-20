import type { ApiClient } from './client';

/**
 * Contract types and calls for the M2 auth endpoints.
 * Source of truth: backend/docs/api/auth-v1.yaml — the admin app only uses
 * the login / refresh / logout / profile subset (M2-T5) and the password-reset
 * rail a new or locked-out admin sets their password on (V1 audit H2).
 */

export type Role = 'rider' | 'driver' | 'admin';

export interface RoleAssignment {
  role: Role;
  state: 'active' | 'suspended';
  /**
   * RBAC fields, present on the `admin` assignment once the M3-T2 backend
   * lands: the single RBAC role and its `domain:action` permission codes.
   * The UI must treat them as absent = no admin permissions (deny by
   * default) — see ../auth/permissions.ts, the only reader.
   */
  rbacRole?: { id: string; name: string } | null;
  permissions?: string[];
}

export interface UserProfile {
  id: string;
  phone: string;
  name: string;
  language: 'en' | 'ar';
  photoUrl?: string | null;
  state: 'active' | 'suspended' | 'deleted';
  roles: RoleAssignment[];
}

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: UserProfile;
}

export interface LoginRequest {
  phone: string;
  password: string;
  client: Role;
}

/** POST /auth/login — 401 bad credentials, 403 no valid role for the client, 429 throttled. */
export function login(client: ApiClient, body: LoginRequest): Promise<AuthTokensResponse> {
  return client.post<AuthTokensResponse>('/api/v1/auth/login', body);
}

/** POST /auth/refresh — rotates the pair; 401 means the session is gone for good. */
export function refreshSession(
  client: ApiClient,
  refreshToken: string,
): Promise<AuthTokensResponse> {
  return client.post<AuthTokensResponse>('/api/v1/auth/refresh', { refreshToken });
}

/**
 * POST /auth/logout — revokes the refresh token. Expects the AUTHED client so
 * an expired access token gets its one refresh before the revocation call.
 */
export function logout(client: ApiClient, refreshToken: string): Promise<void> {
  return client.post<void>('/api/v1/auth/logout', { refreshToken });
}

/** GET /users/me — the own profile (used to revalidate a restored session). */
export function getMyProfile(client: ApiClient): Promise<UserProfile> {
  return client.get<UserProfile>('/api/v1/users/me');
}

/**
 * PUT /users/me — name + account language (auth-v1 UpdateProfileRequest). The
 * admin language switch saves the language here so pushes and the
 * notification center follow it (UC-S-10, V1 audit W14).
 */
export function updateMyProfile(
  client: ApiClient,
  body: { name: string; language: 'en' | 'ar' },
): Promise<UserProfile> {
  return client.put<UserProfile>('/api/v1/users/me', body);
}

/* ---------- Set / reset password (AUTH-03, AUTH-06; V1 audit H2) ---------- */

/**
 * POST /auth/password-reset/start — always 204, whether or not the phone has
 * an account (no enumeration, NFR-S3); the server simply skips sending on a
 * cooldown or the hourly cap. 400 = a phone it cannot canonicalize.
 */
export function startPasswordReset(client: ApiClient, phone: string): Promise<void> {
  return client.post<void>('/api/v1/auth/password-reset/start', { phone });
}

export interface PasswordResetVerifyResponse {
  resetToken: string;
}

/** POST /auth/password-reset/verify — 400 wrong code (attempt counted); 410 expired or tries used up. */
export function verifyPasswordReset(
  client: ApiClient,
  phone: string,
  code: string,
): Promise<PasswordResetVerifyResponse> {
  return client.post<PasswordResetVerifyResponse>('/api/v1/auth/password-reset/verify', {
    phone,
    code,
  });
}

/**
 * POST /auth/password-reset/complete — 204 sets the password and revokes every
 * session (AUTH-03); 400 = invalid/expired reset token or a weak password.
 */
export function completePasswordReset(
  client: ApiClient,
  resetToken: string,
  newPassword: string,
): Promise<void> {
  return client.post<void>('/api/v1/auth/password-reset/complete', { resetToken, newPassword });
}
