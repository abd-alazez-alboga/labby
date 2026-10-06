import { ApiError } from '../api/client';
import type { ApiErrorBody, DocumentType } from '../api/onboarding-types';

/**
 * UC-D-01 E1 — maps the server's 400 `fieldErrors` (keys such as
 * `documents[insurance].expiresOn`, `vehicle.photoFileIds`, `profilePhoto`)
 * back to the wizard step and field they belong to. Server messages are not
 * localized, so each known leaf field gets a localized message of its own.
 */

export type ServerFieldErrors = Record<string, string>;

/** The wizard steps a server error can point at. */
export type ErrorTarget =
  | { step: 'personal' }
  | { step: 'document'; type: DocumentType }
  | { step: 'vehicle' }
  | { step: 'photos' }
  | { step: 'unknown' };

/** The `fieldErrors` of a 400, or null for any other failure. */
export function fieldErrorsOf(error: unknown): ServerFieldErrors | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null;
  const body = error.body as ApiErrorBody | null;
  const fieldErrors = body?.fieldErrors;
  return fieldErrors && Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

const DOCUMENT_KEY = /^documents\[([a-z_]+)\](?:\.(\w+))?$/;

export function targetOf(key: string): ErrorTarget {
  if (key === 'profilePhoto' || key === 'name' || key.startsWith('personal')) {
    return { step: 'personal' };
  }
  const documentMatch = DOCUMENT_KEY.exec(key);
  if (documentMatch) {
    return { step: 'document', type: documentMatch[1] as DocumentType };
  }
  if (key === 'vehicle.photoFileIds' || key.startsWith('vehicle.photoFileIds[')) {
    return { step: 'photos' };
  }
  if (key === 'vehicle' || key.startsWith('vehicle.')) {
    return { step: 'vehicle' };
  }
  return { step: 'unknown' };
}

/** The leaf field of a key: `documents[insurance].expiresOn` → `expiresOn`. */
export function leafOf(key: string): string {
  const withoutIndex = key.replace(/\[[^\]]*\]$/, '');
  const dot = withoutIndex.lastIndexOf('.');
  return dot >= 0 ? withoutIndex.slice(dot + 1) : withoutIndex;
}

const LEAF_MESSAGE_KEYS: Record<string, string> = {
  expiresOn: 'onboarding.server.expiresOn',
  number: 'onboarding.server.number',
  fileId: 'onboarding.server.file',
  photoFileIds: 'onboarding.server.photos',
  profilePhoto: 'onboarding.validation.photoRequired',
  name: 'onboarding.validation.nameRequired',
  make: 'onboarding.server.vehicleField',
  model: 'onboarding.server.vehicleField',
  color: 'onboarding.server.vehicleField',
  plate: 'onboarding.server.vehicleField',
  year: 'onboarding.validation.year',
  seats: 'onboarding.validation.seats',
};

/** Localized message key for a server field error. */
export function messageKeyFor(key: string): string {
  return LEAF_MESSAGE_KEYS[leafOf(key)] ?? 'onboarding.server.generic';
}

/**
 * The server error for one field of a document form. `scope` is the key
 * prefix (`documents[insurance]` in the wizard, '' for a flat renewal body).
 */
export function documentFieldError(
  errors: ServerFieldErrors,
  scope: string,
  field: 'number' | 'expiresOn' | 'fileId',
): string | null {
  const key = scope ? `${scope}.${field}` : field;
  return key in errors ? messageKeyFor(key) : null;
}

/** Errors addressed to a whole document (`documents[insurance]`) rather than a field. */
export function documentLevelError(
  errors: ServerFieldErrors,
  scope: string,
): string | null {
  if (!scope) return null;
  return scope in errors ? 'onboarding.server.generic' : null;
}

/** Drops every error belonging to `predicate`-matching keys (user edited them). */
export function withoutErrors(
  errors: ServerFieldErrors,
  predicate: (key: string) => boolean,
): ServerFieldErrors {
  const next: ServerFieldErrors = {};
  for (const [key, value] of Object.entries(errors)) {
    if (!predicate(key)) next[key] = value;
  }
  return next;
}

export type FailureKind = 'network' | 'server';

/** Network failures (no response) vs server answers (any HTTP error). */
export function failureKindOf(error: unknown): FailureKind {
  return error instanceof ApiError ? 'server' : 'network';
}
