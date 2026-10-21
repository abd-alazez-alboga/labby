import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { getTripDetail } from "../../api/money";
import { isCancelledTrip, isFeeOnlyEarning } from "../../api/money-types";
import type { TripEarning, TripReport } from "../../api/money-types";
import type { ReportStatus } from "../../api/trust-types";
import {
  formatAmountValue,
  formatMoney,
  formatSignedMoney,
  isolateDigits,
} from "../../money/format";
import {
  cancellationOf,
  formatTripDay,
  tripMoment,
  tripPlace,
} from "../../money/trips";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { formatTime } from "../../rides/format";
import { colors, radius, spacing } from "../../theme/tokens";
import { formatDayMonth } from "../../trust/format";
import {
  AppText,
  Banner,
  FailureState,
  Icon,
  LoadingState,
  Muted,
  Screen,
  SecondaryButton,
  StatusChip,
  TextButton,
  useDirection,
} from "../ui";
import type { Tone } from "../ui";
import { FareLine, RiderAvatar } from "../ride/ride-parts";

/** Report outcome chips on the trip (board V1FDriverTripDetailCancelled). */
const REPORT_TONES: Record<ReportStatus, Tone> = {
  open: "accent",
  substantiated: "success",
  unsubstantiated: "neutral",
};

type Load =
  | { status: "loading" }
  | { status: "loaded"; trip: TripEarning }
  | { status: "error"; kind: FailureKind };

/** "Sat 11 Oct · 12:24 – 12:38 · Economy · cash" (cancelled: no end, no method). */
function metaLine(
  t: (key: string) => string,
  trip: TripEarning,
  language: string,
): string {
  const service =
    language === "ar" ? trip.serviceTypeNameAr : trip.serviceTypeNameEn;
  const moment = tripMoment(trip);
  const parts = [formatTripDay(moment, language)];
  if (isCancelledTrip(trip)) {
    parts.push(formatTime(moment, language));
    if (service) parts.push(service);
    return parts.join(" · ");
  }
  const end = formatTime(trip.completedAt, language);
  parts.push(
    trip.startedAt ? `${formatTime(trip.startedAt, language)} – ${end}` : end,
  );
  if (service) parts.push(service);
  parts.push(
    t(
      trip.paymentMethod === "cash" ? "earnings.rowCash" : "earnings.rowWallet",
    ),
  );
  return parts.join(" · ");
}

/** Pickup (ring) and drop-off (accent square) labels. */
function Places({ trip }: { trip: TripEarning }) {
  const { flipRows } = useDirection();
  const rows = [
    { key: "pickup", label: trip.pickupLabel, final: false },
    { key: "destination", label: trip.destinationLabel, final: true },
  ].filter((row) => !!row.label);
  if (rows.length === 0) return null;
  return (
    <View style={styles.places}>
      {rows.map((row) => (
        <View
          key={row.key}
          style={[styles.place, flipRows && styles.rowReverse]}
          testID={`trip-detail-${row.key}`}
        >
          <View style={row.final ? styles.placeEnd : styles.placeStart} />
          <AppText variant="body" weight="700" style={styles.grow}>
            {row.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** The money lines: fare items or the cancellation fee, then the net. */
function MoneyLines({ trip, name }: { trip: TripEarning; name: string }) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const currency = trip.currency;
  const cancellation = cancellationOf(trip);
  const feeOnly = !!cancellation || isFeeOnlyEarning(trip);

  let feeValue: string | null = null;
  let feeColor: string | undefined;
  if (feeOnly) {
    if (trip.cancellationFee) {
      feeValue = formatSignedMoney(trip.cancellationFee, currency, language, {
        alwaysSign: true,
      });
      feeColor = colors.accent;
    } else if (trip.cancellationFeeCharged) {
      feeValue = t("tripDetail.feeNotCollected", {
        amount: formatMoney(trip.cancellationFeeCharged, currency, language),
      });
    } else {
      feeValue = t(
        cancellation === "rider"
          ? "tripDetail.feeNoneFreeWindow"
          : "tripDetail.feeNone",
      );
    }
  }

  return (
    <View testID="trip-detail-lines">
      {feeOnly ? (
        <FareLine
          label={t("tripDetail.cancellationFee")}
          value={feeValue ?? ""}
          valueColor={feeColor}
          testID="trip-line-fee"
        />
      ) : (
        <>
          <FareLine
            label={t(
              trip.paymentMethod === "cash"
                ? "tripDetail.fareCash"
                : "tripEarnings.fareWallet",
            )}
            value={formatMoney(trip.fareTotal, currency, language)}
            testID="trip-line-fare"
          />
          {trip.promoCompensation ? (
            // fareTotal is the pre-discount fare (M13 review W13, I63).
            <FareLine
              label={t("tripEarnings.riderPromo")}
              value={formatSignedMoney(
                -trip.promoCompensation,
                currency,
                language,
              )}
              testID="trip-line-rider-promo"
            />
          ) : null}
          <FareLine
            label={t("tripEarnings.commission", {
              rate: isolateDigits(
                `${formatAmountValue(trip.commissionRate)}%`,
                language,
              ),
            })}
            value={formatSignedMoney(
              -trip.commissionAmount,
              currency,
              language,
            )}
            testID="trip-line-commission"
          />
          {trip.tip ? (
            <FareLine
              label={t("tripDetail.tipFrom", { name })}
              value={formatSignedMoney(trip.tip, currency, language, {
                alwaysSign: true,
              })}
              valueColor={colors.accent}
              testID="trip-line-tip"
            />
          ) : null}
          {trip.promoCompensation ? (
            <FareLine
              label={t("tripEarnings.promoCompensation")}
              value={formatSignedMoney(
                trip.promoCompensation,
                currency,
                language,
                {
                  alwaysSign: true,
                },
              )}
              valueColor={colors.accent}
              testID="trip-line-promo"
            />
          ) : null}
        </>
      )}
      <View style={styles.netLine}>
        <FareLine
          label={t("tripEarnings.balanceChange")}
          value={formatSignedMoney(trip.net, currency, language, {
            alwaysSign: true,
          })}
          testID="trip-line-net"
        />
      </View>
    </View>
  );
}

/** "You reported Hadi · Inappropriate behavior · sent 11 Oct" + outcome chip. */
function ReportedCard({ report, name }: { report: TripReport; name: string }) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  return (
    <View
      style={[styles.reported, flipRows && styles.rowReverse]}
      testID="trip-detail-reported"
    >
      <View style={styles.reportedMark}>
        <Icon name="flag-outline" size={18} color={colors.accent} />
      </View>
      <View style={styles.grow}>
        <AppText variant="body" weight="800">
          {t("tripDetail.reported", { name })}
        </AppText>
        <AppText variant="caption" weight="400" color={colors.textMuted}>
          {t("tripDetail.reportedMeta", {
            category: t(`trust.report.categories.${report.category}`),
            date: formatDayMonth(report.createdAt, language),
          })}
        </AppText>
      </View>
      <StatusChip
        label={t(`trust.reports.status.${report.status}`)}
        tone={REPORT_TONES[report.status]}
        testID="trip-detail-report-status"
      />
    </View>
  );
}

/**
 * V1 conformance W43 (REP-01, UC-S-18; boards V1FDriverTripDetail /
 * V1FDriverTripDetailCancelled): one past trip — completed, or cancelled
 * after the driver accepted — from `GET /driver/earnings/rides/{rideId}`:
 * when, the rider, the places, the COM-01 itemization (or the cancellation
 * fee) and the balance change. "Report rider" opens the existing report
 * flow while `canReport`; once reported, the report and its outcome show
 * instead. Re-read on focus, so a report just sent shows on return.
 */
export function TripDetailScreen({
  rideId,
  memberId = null,
}: {
  rideId: string;
  /** The shared-ride member the row is about, else null. */
  memberId?: string | null;
}) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const loaded = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchTrip = useCallback(async () => {
    // A re-read on focus keeps the trip on screen (and on failure).
    const quiet = loaded.current;
    if (!quiet) setLoad({ status: "loading" });
    try {
      const trip = await getTripDetail(rideId, memberId);
      if (!mounted.current) return;
      loaded.current = true;
      setLoad({ status: "loaded", trip });
    } catch (caught) {
      if (mounted.current && !quiet)
        setLoad({ status: "error", kind: failureKindOf(caught) });
    }
  }, [rideId, memberId]);

  useFocusEffect(
    useCallback(() => {
      void fetchTrip();
    }, [fetchTrip]),
  );

  const trip = load.status === "loaded" ? load.trip : null;
  const firstName = trip?.riderFirstName?.trim() ?? "";
  const name = firstName || t("ride.theRider");
  const cancellation = trip ? cancellationOf(trip) : null;

  let footer: React.ReactNode = null;
  if (trip?.myReport) {
    footer = (
      <>
        <ReportedCard report={trip.myReport} name={name} />
        <TextButton
          title={t("tripDetail.seeReports")}
          onPress={() => router.push("/reports")}
          testID="trip-detail-see-reports"
        />
      </>
    );
  } else if (trip?.canReport) {
    const place = tripPlace(trip);
    footer = (
      <>
        <SecondaryButton
          title={t("tripDetail.reportRider")}
          icon="flag-outline"
          onPress={() =>
            router.push({
              pathname: "/report-rider",
              params: {
                rideId: trip.rideId,
                ...(trip.memberId ? { memberId: trip.memberId } : {}),
                name: firstName,
                when: tripMoment(trip),
                ...(place ? { place } : {}),
              },
            })
          }
          testID="trip-detail-report"
        />
        <Muted testID="trip-detail-report-privacy">
          {t("tripDetail.reportPrivacy", { name })}
        </Muted>
      </>
    );
  }

  return (
    <Screen
      title={t("tripDetail.title")}
      footer={footer}
      testID="trip-detail-screen"
    >
      {load.status === "loading" ? (
        <LoadingState testID="trip-detail-loading" />
      ) : null}
      {load.status === "error" ? (
        <FailureState
          kind={load.kind}
          onRetry={() => void fetchTrip()}
          testID="trip-detail-error"
        />
      ) : null}
      {trip ? (
        <>
          <AppText
            variant="secondary"
            color={colors.textMuted}
            style={styles.meta}
            testID="trip-detail-meta"
          >
            {metaLine(t, trip, language)}
          </AppText>
          {cancellation ? (
            <Banner
              tone="danger"
              icon="close"
              title={t(`tripDetail.cancelled.${cancellation}`, {
                time: formatTime(
                  trip.cancelledAt ?? trip.completedAt,
                  language,
                ),
              })}
              testID="trip-detail-cancelled"
            />
          ) : null}
          {firstName ? <RiderLine name={firstName} /> : null}
          <Places trip={trip} />
          <MoneyLines trip={trip} name={name} />
        </>
      ) : null}
    </Screen>
  );
}

/** The rider's initial, first name and "Your rider". */
function RiderLine({ name }: { name: string }) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  return (
    <View
      style={[styles.rider, flipRows && styles.rowReverse]}
      testID="trip-detail-rider"
    >
      <RiderAvatar firstName={name} size={44} />
      <View style={styles.grow}>
        <AppText variant="rowTitle" weight="800">
          {name}
        </AppText>
        <AppText variant="caption" weight="400" color={colors.textMuted}>
          {t("tripDetail.yourRider")}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rowReverse: { flexDirection: "row-reverse" },
  grow: { flex: 1 },
  meta: { marginTop: -spacing.sm },
  rider: { flexDirection: "row", alignItems: "center", gap: spacing.ms },
  places: { gap: 6 },
  place: { flexDirection: "row", alignItems: "center", gap: 10 },
  placeStart: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2.5,
    borderColor: colors.textSecondary,
  },
  placeEnd: { width: 10, height: 10, backgroundColor: colors.accent },
  netLine: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: spacing.xs,
  },
  reported: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  reportedMark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
});
