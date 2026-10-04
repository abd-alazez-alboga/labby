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
}

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
  };
}
