/**
 * Runtime configuration, fetched from /config.json at boot — never baked in
 * at build time. This keeps one build deployable to every environment:
 * deployments regenerate config.json (e.g. via envsubst in a Docker
 * entrypoint) without rebuilding the app.
 */
export interface RuntimeConfig {
  /** Base URL of the Labby backend API, e.g. "http://localhost:8080". */
  apiBaseUrl: string;
  /** Human-readable environment name, e.g. "local", "staging", "prod". */
  environment?: string;
  /**
   * Leaflet tile URL template (realtime-v1.yaml: tiles come from runtime
   * config, never hard-coded). Absent = the public OSM tile server
   * (`DEFAULT_MAP_TILE_URL`).
   */
  mapTileUrl?: string;
  /**
   * Firebase web config + VAPID key for browser push (ES-03). Absent until
   * the owner supplies it (M6-T5): push registration is then skipped
   * silently and the Firebase SDK is never loaded.
   */
  firebaseWeb?: FirebaseWebConfig;
}

/** The public Firebase web-app config (not a secret) plus the Web Push VAPID key. */
export interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
  authDomain?: string;
  storageBucket?: string;
}

export const DEFAULT_MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const REQUIRED_FIREBASE_KEYS = [
  'apiKey',
  'projectId',
  'messagingSenderId',
  'appId',
  'vapidKey',
] as const;
const OPTIONAL_FIREBASE_KEYS = ['authDomain', 'storageBucket'] as const;

export class RuntimeConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RuntimeConfigError';
  }
}

const CONFIG_URL = `${import.meta.env.BASE_URL}config.json`;

/** Fetches and validates config.json. Rejects with RuntimeConfigError on any failure. */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  let response: Response;
  try {
    response = await fetch(CONFIG_URL, { cache: 'no-store' });
  } catch (cause) {
    throw new RuntimeConfigError(`Could not fetch ${CONFIG_URL}`, { cause });
  }

  if (!response.ok) {
    throw new RuntimeConfigError(`Fetching ${CONFIG_URL} returned HTTP ${response.status}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (cause) {
    throw new RuntimeConfigError(`${CONFIG_URL} is not valid JSON`, { cause });
  }

  return validateRuntimeConfig(data);
}

export function validateRuntimeConfig(data: unknown): RuntimeConfig {
  if (typeof data !== 'object' || data === null) {
    throw new RuntimeConfigError('config.json must contain a JSON object');
  }
  const config = data as Partial<RuntimeConfig>;
  if (typeof config.apiBaseUrl !== 'string' || config.apiBaseUrl.length === 0) {
    throw new RuntimeConfigError('config.json is missing required string "apiBaseUrl"');
  }
  return {
    apiBaseUrl: config.apiBaseUrl,
    environment: typeof config.environment === 'string' ? config.environment : undefined,
    mapTileUrl:
      typeof config.mapTileUrl === 'string' && config.mapTileUrl.length > 0
        ? config.mapTileUrl
        : undefined,
    firebaseWeb: parseFirebaseWeb((data as { firebaseWeb?: unknown }).firebaseWeb),
  };
}

/**
 * The optional push block. Push is an enhancement, never a boot blocker:
 * an absent block (or `null`) means "not configured", and an incomplete one
 * is ignored with a console warning instead of failing the whole app.
 */
function parseFirebaseWeb(value: unknown): FirebaseWebConfig | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const block = (typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const missing = REQUIRED_FIREBASE_KEYS.filter(
    (key) => typeof block[key] !== 'string' || (block[key] as string).length === 0,
  );
  if (missing.length > 0) {
    console.warn(
      `config.json "firebaseWeb" is incomplete (missing ${missing.join(', ')}) — browser push is disabled.`,
    );
    return undefined;
  }
  const parsed: FirebaseWebConfig = {
    apiKey: block.apiKey as string,
    projectId: block.projectId as string,
    messagingSenderId: block.messagingSenderId as string,
    appId: block.appId as string,
    vapidKey: block.vapidKey as string,
  };
  for (const key of OPTIONAL_FIREBASE_KEYS) {
    if (typeof block[key] === 'string' && (block[key] as string).length > 0) {
      parsed[key] = block[key] as string;
    }
  }
  return parsed;
}
