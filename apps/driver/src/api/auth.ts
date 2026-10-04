import type {
  AuthTokensResponse,
  PasswordResetVerifyResponse,
  RegisterVerifyResponse,
  UserProfile,
} from './auth-types';
import { DRIVER_CLIENT } from './auth-types';
import { apiFetch, authFetch } from './client';

/**
 * Typed module for the M2 auth contract (backend/docs/api/auth-v1.yaml).
 * Every function maps 1:1 to a contract operation; the backend is built
 * in parallel, so tests mock fetch at this contract level.
 */

// ---------------------------------------------------------------- register

/** POST /api/v1/auth/register/start — 204 | 409 taken | 429 cooldown/cap. */
export function registerStart(phone: string): Promise<void> {
  return apiFetch<void>('/api/v1/auth/register/start', {
    method: 'POST',
    body: { phone },
  });
}

/** POST /api/v1/auth/register/verify — 200 {mode} | 400 wrong | 410 expired. */
export function registerVerify(
  phone: string,
  code: string,
): Promise<RegisterVerifyResponse> {
  return apiFetch<RegisterVerifyResponse>('/api/v1/auth/register/verify', {
    method: 'POST',
    body: { phone, code },
  });
}

/** POST /api/v1/auth/register/complete — 201 session | 400 invalid token. */
export function registerComplete(input: {
  registrationToken: string;
  password: string;
  name: string;
}): Promise<AuthTokensResponse> {
  return apiFetch<AuthTokensResponse>('/api/v1/auth/register/complete', {
    method: 'POST',
    body: input,
  });
}

// ------------------------------------------------------------------- login

/**
 * POST /api/v1/auth/login with client=driver — 200 | 401 bad credentials or
 * deleted account | 403 no role valid for this client | 429 throttled.
 * Rider-only accounts DO log in here; the driver gate is in-app.
 */
export function login(
  phone: string,
  password: string,
): Promise<AuthTokensResponse> {
  return apiFetch<AuthTokensResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { phone, password, client: DRIVER_CLIENT },
  });
}

/** POST /api/v1/auth/logout — revokes the refresh token server-side. */
export function logout(refreshToken: string, accessToken: string): Promise<void> {
  return apiFetch<void>('/api/v1/auth/logout', {
    method: 'POST',
    body: { refreshToken },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ---------------------------------------------------------- password reset

/** POST /api/v1/auth/password-reset/start — always 204 (no enumeration). */
export function passwordResetStart(phone: string): Promise<void> {
  return apiFetch<void>('/api/v1/auth/password-reset/start', {
    method: 'POST',
    body: { phone },
  });
}

/** POST /api/v1/auth/password-reset/verify — 200 {resetToken} | 400 | 410. */
export function passwordResetVerify(
  phone: string,
  code: string,
): Promise<PasswordResetVerifyResponse> {
  return apiFetch<PasswordResetVerifyResponse>(
    '/api/v1/auth/password-reset/verify',
    { method: 'POST', body: { phone, code } },
  );
}

/** POST /api/v1/auth/password-reset/complete — 204 (sessions revoked) | 400. */
export function passwordResetComplete(
  resetToken: string,
  newPassword: string,
): Promise<void> {
  return apiFetch<void>('/api/v1/auth/password-reset/complete', {
    method: 'POST',
    body: { resetToken, newPassword },
  });
}

// ------------------------------------------------------------ me (authed)

/** POST /api/v1/users/me/2fa/request — 204 code sent | 429 cooldown/cap. */
export function requestTwoFactorCode(): Promise<void> {
  return authFetch<void>('/api/v1/users/me/2fa/request', { method: 'POST' });
}

/** GET /api/v1/users/me. */
export function getMyProfile(): Promise<UserProfile> {
  return authFetch<UserProfile>('/api/v1/users/me');
}

/** PUT /api/v1/users/me — update name and language. */
export function updateMyProfile(input: {
  name: string;
  language: 'en' | 'ar';
}): Promise<UserProfile> {
  return authFetch<UserProfile>('/api/v1/users/me', {
    method: 'PUT',
    body: input,
  });
}

/** DELETE /api/v1/users/me — 204 soft-deleted | 400 wrong OTP | 409 blocked. */
export function deleteMyAccount(otpCode: string): Promise<void> {
  return authFetch<void>('/api/v1/users/me', {
    method: 'DELETE',
    body: { otpCode },
  });
}

/** PUT /api/v1/users/me/password — 204 | 400 wrong password or OTP. */
export function changePassword(input: {
  currentPassword: string;
  otpCode: string;
  newPassword: string;
}): Promise<void> {
  return authFetch<void>('/api/v1/users/me/password', {
    method: 'PUT',
    body: input,
  });
}

// ------------------------------------------------------------ phone change

/** POST /api/v1/users/me/phone-change/start — 204 | 409 new phone in use. */
export function phoneChangeStart(newPhone: string): Promise<void> {
  return authFetch<void>('/api/v1/users/me/phone-change/start', {
    method: 'POST',
    body: { newPhone },
  });
}

/** POST /api/v1/users/me/phone-change/verify-current — 204 | 400 | 410. */
export function phoneChangeVerifyCurrent(code: string): Promise<void> {
  return authFetch<void>('/api/v1/users/me/phone-change/verify-current', {
    method: 'POST',
    body: { code },
  });
}

/** POST /api/v1/users/me/phone-change/complete — 200 profile | 400 | 410. */
export function phoneChangeComplete(code: string): Promise<UserProfile> {
  return authFetch<UserProfile>('/api/v1/users/me/phone-change/complete', {
    method: 'POST',
    body: { code },
  });
}

// ------------------------------------------------------------------- photo

export interface PhotoUploadInput {
  uri: string;
  fileName: string;
  mimeType: string;
}

/** PUT /api/v1/users/me/photo (multipart) — 200 profile | 400 type/size. */
export function uploadMyPhoto(input: PhotoUploadInput): Promise<UserProfile> {
  const form = new FormData();
  // React Native's fetch uploads {uri,name,type} descriptors as file parts.
  form.append('file', {
    uri: input.uri,
    name: input.fileName,
    type: input.mimeType,
  } as unknown as Blob);
  return authFetch<UserProfile>('/api/v1/users/me/photo', {
    method: 'PUT',
    body: form,
  });
}
