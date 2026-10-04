import type { ApiClient } from './client';

/** Response of `GET /api/v1/meta` — the backend's public metadata. */
export interface ApiMeta {
  name: string;
  version: string;
}

/** Fetches the backend's name and version (the M1-T6 integration smoke call). */
export function getMeta(client: ApiClient): Promise<ApiMeta> {
  return client.get<ApiMeta>('/api/v1/meta');
}
