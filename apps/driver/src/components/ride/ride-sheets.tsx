import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import type { Ride } from "../../api/ride-types";
import type {
  DriverRideContextValue,
  RideActionError,
} from "../../rides/DriverRideProvider";
import {
  formatClock,
  formatDistance,
  formatMinutes,
  formatMoney,
  formatNumber,
  formatTime,
  placeLabel,
} from "../../rides/format";
import { useNow } from "../../rides/use-now";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  Icon,
  OutlineButton,
  PrimaryButton,
  SquareIconButton,
  StatusChip,
  useDirection,
} from "../ui";
import {
  ComfortChips,
  ProgressBar,
  RiderAvatar,
  RouteSteps,
  StreamLostBanner,
  comfortLabels,
} from "./ride-parts";
import { SafetyRow } from "./safety-actions";
import { seatsAndParties } from "./shared-parts";

/**
 * The bottom sheets of the active-ride map screens (design canvas "To
 * pickup", "At pickup", "In ride"). Glanceable (NFR-U2): one 64–72 px
 * primary action, the key number in large type, no typing.
 */

function serviceName(ride: Ride, language: string): string {
  return language === "ar" ? ride.serviceTypeNameAr : ride.serviceTypeNameEn;
}

function riderName(t: TFunction, ride: Ride): string {
  // M12: a shared ride is a group of parties (UC-D-13).
  if (ride.kind === "shared") return t("ride.shared.group");
  return ride.rider?.firstName?.trim() || t("ride.theRider");
}

/**
 * M12 chips on the to-pickup sheet: a converted scheduled ride shows its
 * pickup time, a shared ride its seats and parties.
 */
function KindChip({ ride }: { ride: Ride }) {
  const { flipRows } = useDirection();
  return (
    <View style={flipRows ? styles.chipEnd : null}>
      <KindChipLabel ride={ride} />
    </View>
  );
}

function KindChipLabel({ ride }: { ride: Ride }) {
  const { t } = useTranslation();
  const { language } = useDirection();
  if (ride.kind === "scheduled" && ride.scheduled) {
    return (
      <StatusChip
        tone="accent"
        label={t("ride.scheduledChip", {
          time: formatTime(ride.scheduled.scheduledAt, language),
        })}
        testID="ride-kind-chip"
      />
    );
  }
  if (ride.kind === "shared" && ride.shared) {
    const parties = ride.shared.members.filter(
      (member) => member.status === "joined",
    ).length;
    return (
      <StatusChip
        tone="accent"
        label={t("ride.shared.chip", {
          detail: seatsAndParties(t, ride.shared.seatsTaken, parties, language),
        })}
        testID="ride-kind-chip"
      />
    );
  }
  return null;
}

/** Network / server failure of the screen's own action (geofence etc. are rendered inline). */
function ActionError({ error }: { error: RideActionError | null }) {
  const { t } = useTranslation();
  if (!error || (error.kind !== "network" && error.kind !== "server"))
    return null;
  return (
    <Banner
      tone="danger"
      message={t(`ride.errors.${error.kind}`)}
      testID={`ride-action-error-${error.kind}`}
    />
  );
}

// -------------------------------------------------------------- to pickup

/** UC-D-07 — rider + comfort chips, the geofence hint from a 422, Cancel + big Arrived. */
export function ToPickupSheet({
  ctx,
  ride,
  onCancel,
}: {
  ctx: DriverRideContextValue;
  ride: Ride;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const name = riderName(t, ride);
  const error = ctx.error?.action === "arrive" ? ctx.error : null;
  const busy = ctx.pending !== null;

  return (
    <View style={styles.group} testID="to-pickup-sheet">
      <View style={[styles.row, flipRows && styles.rowReverse]}>
        <RiderAvatar firstName={name} />
        <View style={styles.grow}>
          <AppText variant="heading" testID="to-pickup-title">
            {t("ride.toPickup.title", { name })}
          </AppText>
          <AppText variant="secondary" color={colors.textSecondary}>
            {t("ride.toPickup.summary", {
              service: serviceName(ride, language),
              payment: t(`ride.payment.${ride.paymentMethod}`),
              fare: formatMoney(
                ride.estimate.components.total,
                ride.estimate.components.currency,
                language,
              ),
            })}
          </AppText>
          {/* I74 (board D12Converted): a converted claim priced with live surge says so. */}
          {ride.scheduled?.claimState === "converted" &&
          ride.surgeMultiplier > 1 ? (
            <AppText
              variant="caption"
              weight="400"
              color={colors.textSecondary}
              testID="to-pickup-live-surge"
            >
              {t("ride.toPickup.liveSurge")}
            </AppText>
          ) : null}
        </View>
      </View>

      <KindChip ride={ride} />

      {ride.rider && ride.kind !== "shared" ? (
        <ComfortChips comfort={ride.rider.comfort} testID="rider-comfort" />
      ) : null}

      {/* M10 (UC-S-13..15): Chat / Call / Share trip. */}
      <SafetyRow ride={ride} />

      {ride.driverStream === "lost" ? <StreamLostBanner /> : null}

      {error?.kind === "outsideGeofence" ? (
        <Banner
          tone="warning"
          message={
            error.distanceMeters !== null
              ? t("ride.toPickup.outsideGeofence", {
                  distance: formatDistance(t, error.distanceMeters, language),
                  geofence: formatDistance(t, error.geofenceMeters, language),
                })
              : t("ride.toPickup.outsideGeofenceNoDistance", {
                  geofence: formatDistance(t, error.geofenceMeters, language),
                })
          }
          messageTestID="geofence-hint-text"
          testID="geofence-hint"
        />
      ) : null}
      {error?.kind === "noPosition" ? (
        <Banner
          tone="warning"
          icon="location-outline"
          message={t("ride.toPickup.noPosition")}
          testID="no-position-hint"
        />
      ) : null}
      <ActionError error={error} />

      <View style={[styles.actions, flipRows && styles.rowReverse]}>
        <SquareIconButton
          icon="close"
          accessibilityLabel={t("ride.cancel.open")}
          onPress={onCancel}
          disabled={busy}
          testID="ride-cancel-open"
        />
        <View style={styles.grow}>
          <PrimaryButton
            title={t("ride.toPickup.arrived")}
            size="large"
            onPress={() => void ctx.arrive()}
            disabled={busy}
            busy={ctx.pending === "arrive"}
            testID="ride-arrived"
          />
        </View>
      </View>
    </View>
  );
}

/** Top card text while driving to the pickup: live distance + server ETA. */
export function toPickupInstruction(
  t: TFunction,
  ride: Ride,
  language: string,
  distanceToPickup: number | null,
  routeDurationSeconds: number | null,
): { title: string; subtitle: string } {
  const eta = ride.etaSeconds ?? routeDurationSeconds;
  const parts: string[] = [];
  if (eta !== null && eta !== undefined)
    parts.push(formatMinutes(t, eta, language));
  if (distanceToPickup !== null)
    parts.push(formatDistance(t, distanceToPickup, language));
  return {
    title: parts.length > 0 ? parts.join(" · ") : t("ride.toPickup.headTo"),
    subtitle: t("ride.toPickup.subtitle", {
      place: placeLabel(t, ride.pickup),
    }),
  };
}

// -------------------------------------------------------------- at pickup

/**
 * UC-D-07 steps 2–3 / E2 — waiting timer since `driverArrivedAt`, the free
 * wait counting down to `waitGraceEndsAt`, big Start ride; "No-show" stays
 * disabled until the wait grace is over, then opens the cancel sheet with
 * `rider_no_show` preselected.
 */
export function AtPickupSheet({
  ctx,
  ride,
  onCancel,
  onNoShow,
}: {
  ctx: DriverRideContextValue;
  ride: Ride;
  onCancel: () => void;
  onNoShow: () => void;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const now = useNow(true, 500);
  const name = riderName(t, ride);
  const arrivedAt = ride.timeline.driverArrivedAt
    ? Date.parse(ride.timeline.driverArrivedAt)
    : null;
  const graceEndsAt = ride.waitGraceEndsAt
    ? Date.parse(ride.waitGraceEndsAt)
    : null;
  const waited = arrivedAt !== null ? now - arrivedAt : 0;
  const graceLeft = graceEndsAt !== null ? graceEndsAt - now : 0;
  const noShowAllowed = graceEndsAt !== null && graceLeft <= 0;
  const graceTotal =
    arrivedAt !== null && graceEndsAt !== null ? graceEndsAt - arrivedAt : 0;
  const busy = ctx.pending !== null;
  const error = ctx.error?.action === "start" ? ctx.error : null;

  return (
    <View style={styles.group} testID="at-pickup-sheet">
      <View style={[styles.row, styles.between, flipRows && styles.rowReverse]}>
        <View style={styles.grow}>
          <AppText variant="bodyStrong" color={colors.textSecondary}>
            {t("ride.atPickup.waitingFor", { name })}
          </AppText>
          <AppText style={styles.bigTimer} testID="wait-timer">
            {formatClock(waited, language)}
          </AppText>
        </View>
        <RiderAvatar firstName={name} />
      </View>

      {graceEndsAt !== null ? (
        <>
          <ProgressBar
            fraction={graceTotal > 0 ? waited / graceTotal : 1}
            testID="wait-progress"
          />
          <AppText color={colors.textSecondary} testID="free-wait-text">
            {noShowAllowed
              ? t("ride.atPickup.freeWaitOver")
              : t("ride.atPickup.freeWaitEndsIn", {
                  time: formatClock(graceLeft, language),
                })}
          </AppText>
        </>
      ) : null}

      <View style={[styles.pickupCard, flipRows && styles.rowReverse]}>
        <Icon name="location-outline" />
        <View style={styles.grow}>
          <AppText variant="bodyStrong" weight="800">
            {placeLabel(t, ride.pickup)}
          </AppText>
          {ride.rider ? (
            <AppText
              variant="caption"
              weight="400"
              color={colors.textSecondary}
              testID="rider-comfort-summary"
            >
              {comfortLabels(t, ride.rider.comfort).join(" · ")}
            </AppText>
          ) : null}
        </View>
      </View>

      {/* M10 (UC-S-13..15): Chat / Call / Share trip. */}
      <SafetyRow ride={ride} />

      {ride.driverStream === "lost" ? <StreamLostBanner /> : null}
      <ActionError error={error} />

      <PrimaryButton
        title={t("ride.atPickup.start")}
        size="hero"
        onPress={() => void ctx.start()}
        disabled={busy}
        busy={ctx.pending === "start"}
        testID="ride-start"
      />

      <View style={[styles.actions, flipRows && styles.rowReverse]}>
        <View style={styles.grow}>
          <OutlineButton
            title={
              noShowAllowed
                ? t("ride.atPickup.noShow")
                : t("ride.atPickup.noShowIn", {
                    time: formatClock(Math.max(0, graceLeft), language),
                  })
            }
            onPress={onNoShow}
            disabled={!noShowAllowed || busy}
            testID="ride-no-show"
          />
        </View>
        <View style={styles.grow}>
          <OutlineButton
            title={t("ride.cancel.open")}
            onPress={onCancel}
            disabled={busy}
            testID="ride-cancel-open"
          />
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- in ride

/**
 * UC-D-08 — the in-ride sheet. Header per board DriverSafetyActions (I64,
 * owner ruling 2026-10-20: it supersedes DriverInRide): "To drop-off" with
 * the ETA, the drop-off and rider below; then the stops + drop-off ("route
 * updated by rider" after a `ride.updated` route_changed), Chat / Call /
 * Share, the service + payment with the estimated fare (the final fare is
 * metered) and the big near-black End ride.
 */
export function InRideSheet({
  ctx,
  ride,
  etaSeconds,
}: {
  ctx: DriverRideContextValue;
  ride: Ride;
  /** Time to the drop-off: the server ETA, else the drawn route's. */
  etaSeconds: number | null;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const name =
    ride.kind === "shared" ? t("ride.shared.inRideTitle") : riderName(t, ride);
  const error = ctx.error?.action === "complete" ? ctx.error : null;

  return (
    <View style={styles.group} testID="in-ride-sheet">
      <View>
        <View
          style={[styles.row, styles.between, flipRows && styles.rowReverse]}
        >
          <AppText variant="heading" style={styles.grow} testID="in-ride-title">
            {t("ride.inRide.toDropOff")}
          </AppText>
          {etaSeconds !== null ? (
            <AppText
              variant="heading"
              color={colors.accent}
              testID="in-ride-eta"
            >
              {formatMinutes(t, etaSeconds, language)}
            </AppText>
          ) : null}
        </View>
        <AppText
          variant="secondary"
          color={colors.textSecondary}
          testID="in-ride-subtitle"
        >
          {t("ride.inRide.subtitle", {
            place: placeLabel(t, ride.destination),
            name,
          })}
        </AppText>
      </View>

      <RouteSteps
        steps={[
          ...ride.stops.map((stop, index) => ({
            key: `stop-${index}`,
            caption: t("ride.stopN", { n: formatNumber(index + 1, language) }),
            place: stop,
            testID: `ride-stop-${index}`,
          })),
          {
            key: "destination",
            caption: ctx.routeChanged
              ? t("ride.inRide.dropOffUpdated")
              : t("ride.dropOff"),
            place: ride.destination,
            final: true,
            testID: "ride-destination",
          },
        ]}
      />
      {ctx.routeChanged ? (
        <AppText
          variant="caption"
          color={colors.accent}
          testID="route-changed"
        >
          {t("ride.inRide.routeChanged")}
        </AppText>
      ) : null}

      {/* M10 (UC-S-13..15): Chat / Call / Share trip. */}
      <SafetyRow ride={ride} />

      <View style={styles.fareBlock} testID="in-ride-fare">
        <AppText variant="caption" weight="400" color={colors.textMuted}>
          {t("ride.inRide.fareCaption", {
            service: serviceName(ride, language),
            payment: t(`ride.payment.${ride.paymentMethod}`),
          })}
        </AppText>
        <AppText variant="bodyStrong" weight="800" testID="in-ride-estimate">
          {t("ride.inRide.estimate", {
            fare: formatMoney(
              ride.estimate.components.total,
              ride.estimate.components.currency,
              language,
            ),
          })}
        </AppText>
      </View>

      {ride.driverStream === "lost" ? <StreamLostBanner /> : null}
      <ActionError error={error} />

      <PrimaryButton
        title={t("ride.inRide.end")}
        size="hero"
        tone="dark"
        onPress={() => void ctx.complete()}
        disabled={ctx.pending !== null}
        busy={ctx.pending === "complete"}
        testID="ride-end"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  between: { justifyContent: "space-between" },
  rowReverse: { flexDirection: "row-reverse" },
  grow: { flex: 1 },
  chipEnd: { alignItems: "flex-end" },
  actions: { flexDirection: "row", gap: 10, alignItems: "center" },
  bigTimer: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: "800",
  },
  fareBlock: {
    gap: 2,
    paddingTop: spacing.ms,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  pickupCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.md,
    paddingVertical: spacing.ms,
    paddingHorizontal: 14,
  },
});
