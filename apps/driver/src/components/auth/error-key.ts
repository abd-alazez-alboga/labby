import { ApiError } from "../../api/client";

/** Maps an API failure to an i18n key: contract statuses first, then fallbacks. */
export function errorKeyFor(
  error: unknown,
  byStatus: Record<number, string>,
): string {
  if (error instanceof ApiError) {
    return byStatus[error.status] ?? "auth.errors.generic";
  }
  return "auth.errors.network";
}
