/**
 * "Contact support" about a suspension (UC-R-04 E3, V1 audit W39 —
 * approved artboards V1FRiderSuspendedAppeal, V1FRiderBookingRefused,
 * V1FRiderSuspendedTicket): the suspension reason in plain words and the
 * route into the create-ticket flow, pre-filled with the `account_suspend`
 * category and an editable line naming the reason.
 */
import type { TranslateOptions } from "i18n-js";

import type { SuspensionReason } from "../api/auth";
import type { AppLocale } from "../i18n/translations";
import { formatDate } from "../ride/ride-format";
import type { RiderSuspension } from "./suspension";

type T = (key: string, options?: TranslateOptions) => string;

const KNOWN_REASONS: readonly SuspensionReason[] = [
  "document_expired",
  "low_rating",
  "manual",
];

/** A `suspensionReason` value from a route param or an error detail, or null. */
export function knownSuspensionReason(
  value: string | null | undefined,
): SuspensionReason | null {
  return value && (KNOWN_REASONS as readonly string[]).includes(value)
    ? (value as SuspensionReason)
    : null;
}

/** The create-ticket route about this suspension (`reason` = fallback code). */
export function suspensionTicketHref(reason?: string | null): string {
  const known = knownSuspensionReason(reason);
  return `/new-ticket?about=suspension${known ? `&reason=${known}` : ""}`;
}

/**
 * The reason as the rider was shown it: the admin's note, or the rating
 * rule for a role suspended for `low_rating`; null when unknown.
 */
export function suspensionReasonText(
  suspension: RiderSuspension | null,
  t: T,
): string | null {
  if (suspension?.note) return suspension.note;
  if (suspension?.scope === "role" && suspension.reason === "low_rating") {
    return t("suspended.lowRating");
  }
  return null;
}

/** The suspension date ("14 Oct"), or null when the profile has none. */
export function suspensionDate(
  suspension: RiderSuspension | null,
  locale: AppLocale,
): string | null {
  return suspension?.suspendedAt
    ? formatDate(suspension.suspendedAt, locale)
    : null;
}

/** The pre-filled ticket description (editable before sending). */
export function suspensionTicketDescription(
  suspension: RiderSuspension | null,
  t: T,
  locale: AppLocale,
): string {
  const reason = suspensionReasonText(suspension, t);
  const date = suspensionDate(suspension, locale);
  const account = suspension?.scope === "account";
  return [
    date
      ? t(
          account
            ? "suspended.ticket.accountLineDated"
            : "suspended.ticket.roleLineDated",
          { date },
        )
      : t(
          account
            ? "suspended.ticket.accountLine"
            : "suspended.ticket.roleLine",
        ),
    reason ? t("suspended.ticket.reasonLine", { reason }) : null,
    t("suspended.ticket.reviewLine"),
  ]
    .filter((line): line is string => !!line)
    .join(" ");
}

/**
 * The suspension the profile shows, its unknown reason filled from
 * `fallbackReason` (a booking refusal's `details.suspensionReason`, read
 * before the profile re-read lands); a role suspension when the profile
 * shows none yet.
 */
export function withFallbackReason(
  suspension: RiderSuspension | null,
  fallbackReason: string | null | undefined,
): RiderSuspension {
  const base = suspension ?? {
    scope: "role" as const,
    reason: null,
    note: null,
    suspendedAt: null,
  };
  return base.reason
    ? base
    : { ...base, reason: knownSuspensionReason(fallbackReason) };
}
