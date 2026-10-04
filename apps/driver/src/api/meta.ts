import { apiFetch } from './client';

/** Response of `GET /api/v1/meta` — the backend's public metadata. */
export interface ApiMeta {
  name: string;
  version: string;
}

/** Fetches the backend's name and version (the M1-T6 integration smoke call). */
export function getMeta(): Promise<ApiMeta> {
  return apiFetch<ApiMeta>('/api/v1/meta');
}
