import type { ApiClient } from './client';

/**
 * Contract types and calls for the M2 auth endpoints.
 * Source of truth: backend/docs/api/auth-v1.yaml — the admin app only uses
 * the login / refresh / logout / profile subset (M2-T5).
 */

export type Role = 'rider' | 'driver' | 'admin';

export interface RoleAssignment {
  role: Role;
  state: 'active' | 'suspended';
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
