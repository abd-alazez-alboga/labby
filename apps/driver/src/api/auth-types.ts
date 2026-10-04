/**
 * Types mirroring the M2 auth contract: backend/docs/api/auth-v1.yaml.
 * Kept free of imports so both the API layer and the session store can
 * depend on them without cycles.
 */

export type AppLanguage = 'en' | 'ar';

export type RoleName = 'rider' | 'driver' | 'admin';
export type RoleState = 'active' | 'suspended';
export type AccountState = 'active' | 'suspended' | 'deleted';

export interface RoleAssignment {
  role: RoleName;
  state: RoleState;
}

export interface UserProfile {
  id: string;
  phone: string;
  name: string;
  language: AppLanguage;
  photoUrl?: string | null;
  state: AccountState;
  roles: RoleAssignment[];
}

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: UserProfile;
}

export type RegisterVerifyMode = 'new' | 'reactivated';

export interface RegisterVerifyResponse {
  mode: RegisterVerifyMode;
  /** Present only when mode = `new`. */
  registrationToken?: string | null;
}

export interface PasswordResetVerifyResponse {
  resetToken: string;
}

/** Client identifier the login endpoint expects — this app is the driver one. */
export const DRIVER_CLIENT = 'driver' as const;

/** Contract validation patterns (components.schemas in auth-v1.yaml). */
export const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
export const OTP_PATTERN = /^[0-9]{6}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

/** AUTH-04: seconds a user must wait before requesting another OTP. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** True when the profile holds an ACTIVE `driver` role (the in-app gate). */
export function hasActiveDriverRole(user: UserProfile): boolean {
  return user.roles.some(
    (assignment) => assignment.role === 'driver' && assignment.state === 'active',
  );
}
