/**
 * The ride on screen, by state (UC-R-05…07, UC-R-09) — approved artboards:
 * - requested / offering            RiderFinding ("Finding your driver")
 * - cancelled_by_driver, re-dispatched → the same sheet, "Finding you
 *   another driver" (no rider action: the facade follows the new ride)
 * - no_driver_found                 RiderNoDriver (one-tap retry, edit trip)
 * - accepted                        RiderDriverOnWay (driver, plate, ETA,
 *   live position) — Call / Message / Share trip / Safety are M10 and
 *   hidden; the cancel action takes the Safety button's place
 * - driver_arrived                  RiderArrived (free-waiting countdown)
 * - in_progress                     RiderInRide (stops, change destination /
 *   add stop, no cancel — UC-R-09 E1)
 * - completed                       RiderComplete (stored fare components,
 *   cash due)
 * - cancelled_by_rider / rider no-show: the recorded fee (or "not
 *   charged") and Done.
 * The connection-lost banner shows whenever the driver's stream is lost.
 * Ratings never render (null until M11).
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RIDER_CANCELLABLE_STATES, type Ride } from "../../api/rides";
import { type TipResponse, withinTipWindow } from "../../api/wallet";
import {
  AppText,
  Banner,
  BottomSheet,
  LoadingView,
  MapFab,
  MapScreen,
  PrimaryButton,
  ScreenScrollView,
  SecondaryButton,
  TextButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useOptionalRegion } from "../../region/region-context";
import { useActiveRide } from "../../ride/ride-context";
import { rideErrorMessage } from "../../ride/ride-errors";
import {
  formatClock,
  formatCountdown,
  formatKm,
  formatMinutes,
  formatMoney,
  placeLabel,
  serviceName,
} from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { TipSheet } from "../wallet/tip-sheet";
import { CancelSheet } from "./cancel-sheet";
import {
  DriverCard,
  EstimateFooter,
  FareBreakdown,
  IconWell,
  RideMap,
  ridePaymentLine,
  RouteColumn,
  useNow,
} from "./ride-parts";

/** Floating row height (8 px offset + 48 px button) plus breathing room. */
const FLOATING_CLEARANCE = 72;

function etaMinutes(seconds: number | null, locale: "en" | "ar") {
  return seconds == null ? null : formatMinutes(seconds, locale);
}

function OutlineAction({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <SecondaryButton
      label={label}
      onPress={onPress}
      testID={testID}
      style={styles.pill}
    />
  );
}

export function RideView({
  ride,
  onDone,
}: {
  ride: Ride;
  /** After Done / Close on an ended ride. */
  onDone: () => void;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const { top } = useSafeAreaInsets();
  const router = useRouter();
  const facade = useActiveRide();
  // Ticks only where a clock is shown (wait countdown, arrival time).
  const now = useNow(
    ride.state === "driver_arrived" || ride.state === "in_progress"
      ? 1000
      : null,
  );
  const [cancelOpen, setCancelOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipSent, setTipSent] = useState<TipResponse | null>(null);
  const region = useOptionalRegion();

  const driver = ride.driver ?? null;
  const name = serviceName(
    { nameEn: ride.serviceTypeNameEn, nameAr: ride.serviceTypeNameAr },
    locale,
  );
  const minutes = etaMinutes(facade.etaSeconds, locale);
  const cancellable = RIDER_CANCELLABLE_STATES.includes(ride.state);
  const lost =
    facade.driverStream === "lost" &&
    (ride.state === "accepted" ||
      ride.state === "driver_arrived" ||
      ride.state === "in_progress");

  const openCancel = () => setCancelOpen(true);
  const done = () => {
    facade.dismiss();
    onDone();
  };

  // ------------------------------------------------------------ completed
  if (ride.state === "completed" && ride.fare) {
    const fare = ride.fare;
    const completedAt = ride.timeline.completedAt;
    const currency = fare.components.currency;
    const total = fare.components.total;
    // PAY-02 split (M8): wallet part, the fare's cash remainder, and any
    // collected dues carried into cashDue (derived — the contract sends
    // walletApplied and the combined cashDue).
    const walletApplied = ride.walletApplied ?? 0;
    const cashDue = ride.cashDue ?? 0;
    const fareCash = Math.min(cashDue, Math.max(0, total - walletApplied));
    const carriedDue = Math.max(0, cashDue - fareCash);
    const hasSplit = walletApplied > 0 || carriedDue > 0;
    const tipAmount = tipSent?.amount ?? ride.tip ?? null;
    const statusLabel =
      ride.paymentStatus === "paid_cash"
        ? t("ride.paidCash")
        : ride.paymentStatus === "paid_wallet"
          ? t("ride.paidWallet")
          : ride.paymentStatus === "paid_mixed"
            ? t("ride.paidMixed")
            : ride.paymentStatus === "unpaid"
              ? t("ride.unpaid")
              : walletApplied > 0
                ? t("ride.payRemainder")
                : t("ride.payCash");
    const splitRows: { key: string; label: string; amount: number; strong?: boolean }[] =
      hasSplit
        ? [
            ...(walletApplied > 0
              ? [{ key: "wallet", label: t("ride.walletLine"), amount: walletApplied }]
              : []),
            ...(fareCash > 0
              ? [{ key: "cash", label: t("ride.cashRestLine"), amount: fareCash }]
              : []),
            ...(carriedDue > 0
              ? [{ key: "due", label: t("ride.carriedFeeLine"), amount: carriedDue }]
              : []),
            ...(cashDue > 0
              ? [
                  {
                    key: "handed",
                    label: t("ride.cashHandedLine"),
                    amount: cashDue,
                    strong: true,
                  },
                ]
              : []),
          ]
        : [];
    const canTip =
      !!driver && tipAmount === null && withinTipWindow(completedAt);
    return (
      <ScreenScrollView
        style={styles.page}
        contentContainerStyle={[styles.completeContent, { paddingTop: top + 48 }]}
        testID="ride-completed"
      >
        <IconWell name="checkmark" accent />
        <View style={styles.titleBlock}>
          <AppText variant="display">{t("ride.completedTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {completedAt
              ? `${placeLabel(ride.destination)} · ${formatClock(completedAt, locale)}`
              : placeLabel(ride.destination)}
          </AppText>
        </View>
        <View style={styles.cashBox} testID="ride-cash-due">
          <AppText variant="label" weight={700} tone="secondary">
            {statusLabel}
          </AppText>
          <AppText style={styles.bigAmount} weight={800} testID="ride-total">
            {formatMoney(total, currency, locale, t)}
          </AppText>
          <AppText variant="caption" tone="muted" weight={400}>
            {t("ride.meteredSummary", {
              km: formatKm(fare.distanceMeters, locale),
              minutes: formatMinutes(fare.durationSeconds, locale),
            })}
          </AppText>
          {splitRows.map((line) => (
            <View
              key={line.key}
              style={[styles.splitRow, { flexDirection: row }]}
              testID={`ride-paid-${line.key}`}
            >
              <AppText
                variant="secondary"
                tone="secondary"
                weight={line.strong ? 800 : 400}
                style={styles.flex}
              >
                {line.label}
              </AppText>
              <AppText variant="secondary" weight={line.strong ? 800 : 700}>
                {formatMoney(line.amount, currency, locale, t)}
              </AppText>
            </View>
          ))}
          {tipAmount !== null ? (
            <View
              style={[styles.splitRow, { flexDirection: row }]}
              testID="ride-paid-tip"
            >
              <AppText variant="secondary" tone="secondary" style={styles.flex}>
                {t("ride.tipLine")}
              </AppText>
              <AppText variant="secondary" weight={700}>
                {formatMoney(tipAmount, currency, locale, t)}
              </AppText>
            </View>
          ) : null}
        </View>
        {tipSent ? (
          <Banner tone="success" message={t("tip.sent")} testID="ride-tip-sent" />
        ) : null}
        <FareBreakdown components={fare.components} measured={fare} />
        {driver ? (
          <View style={styles.dividerTop}>
            <DriverCard driver={driver} compact subtitleSuffix={name} />
          </View>
        ) : null}
        <View style={styles.actions}>
          {canTip ? (
            <SecondaryButton
              label={t("tip.title", { name: driver.firstName })}
              onPress={() => setTipOpen(true)}
              testID="ride-tip"
            />
          ) : null}
          <SecondaryButton
            label={t("ride.viewReceipt")}
            onPress={() => router.push(`/receipt/${ride.id}` as never)}
            testID="ride-view-receipt"
          />
          <PrimaryButton label={t("ride.done")} onPress={done} testID="ride-done" />
        </View>
        {canTip ? (
          <TipSheet
            visible={tipOpen}
            onClose={() => setTipOpen(false)}
            rideId={ride.id}
            currency={currency}
            driverName={driver?.firstName ?? null}
            completedAt={completedAt ?? null}
            rideLine={
              completedAt
                ? `${placeLabel(ride.destination)} · ${formatMoney(total, currency, locale, t)}`
                : null
            }
            onTipped={setTipSent}
          />
        ) : null}
      </ScreenScrollView>
    );
  }

  // ---------------------------------------------------------- map states
  const redispatching =
    ride.state === "cancelled_by_driver" &&
    ride.cancellationReason !== "rider_no_show";
  const finding =
    ride.state === "requested" || ride.state === "offering" || redispatching;
  const followingRedispatch =
    redispatching || (finding && !!ride.redispatchOfRideId);

  let sheet: React.ReactNode;

  if (finding) {
    sheet = (
      <BottomSheet testID="ride-finding">
        <View style={styles.titleBlock}>
          <AppText variant="title">
            {followingRedispatch
              ? t("ride.redispatchTitle")
              : t("ride.findingTitle")}
          </AppText>
          <AppText variant="body" tone="secondary">
            {followingRedispatch
              ? t("ride.redispatchBody")
              : t("ride.findingBody")}
          </AppText>
        </View>
        <RouteColumn
          pickup={ride.pickup}
          stops={ride.stops}
          destination={ride.destination}
        />
        <View style={[styles.estimateBox, { flexDirection: row }]}>
          <View style={styles.flex}>
            <EstimateFooterInline ride={ride} />
          </View>
          <AppText variant="caption" weight={700} tone="secondary">
            {t("ride.freeToCancel")}
          </AppText>
        </View>
        {redispatching ? null : (
          <SecondaryButton
            label={t("ride.cancelRequest")}
            onPress={openCancel}
            testID="ride-cancel"
          />
        )}
      </BottomSheet>
    );
  } else if (ride.state === "no_driver_found") {
    sheet = (
      <BottomSheet testID="ride-no-driver">
        <IconWell name="car-outline" />
        <View style={styles.titleBlock}>
          <AppText variant="title">{t("ride.noDriverTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {t("ride.noDriverBody")}
          </AppText>
        </View>
        <View style={styles.tripBox}>
          <AppText variant="bodyStrong" weight={800}>
            {`${placeLabel(ride.pickup)} → ${placeLabel(ride.destination)}`}
          </AppText>
          <AppText variant="caption" tone="secondary" weight={400}>
            {`${ridePaymentLine(ride, locale, t)} · ${t(
              "ride.estimateAmount",
              {
                money: formatMoney(
                  ride.estimate.components.total,
                  ride.estimate.components.currency,
                  locale,
                  t,
                ),
              },
            )}`}
          </AppText>
        </View>
        {ride.pickupDistanceMode !== "accept_distant_fee" ? (
          <View style={[styles.hint, { flexDirection: row }]}>
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={colors.textSecondary}
            />
            <AppText variant="secondary" tone="secondary" style={styles.flex}>
              {t("ride.distantHint")}
            </AppText>
            <TextButton
              label={t("ride.settings")}
              onPress={() => router.push("/ride-preferences")}
              testID="ride-open-preferences"
            />
          </View>
        ) : null}
        {retryError ? (
          <Banner tone="danger" message={retryError} testID="ride-retry-error" />
        ) : null}
        <View style={[styles.twoButtons, { flexDirection: row }]}>
          <SecondaryButton
            label={t("ride.editTrip")}
            onPress={() => router.push("/booking?edit=1" as never)}
            style={styles.flex1}
            testID="ride-edit-trip"
          />
          <PrimaryButton
            label={t("ride.tryAgain")}
            loading={retrying}
            onPress={() => {
              setRetrying(true);
              setRetryError(null);
              facade
                .retry()
                .catch((error) => setRetryError(rideErrorMessage(error, t)))
                .finally(() => setRetrying(false));
            }}
            style={styles.flex2}
            testID="ride-retry"
          />
        </View>
      </BottomSheet>
    );
  } else if (ride.state === "accepted" && driver) {
    sheet = (
      <BottomSheet testID="ride-accepted">
        <View style={[styles.headline, { flexDirection: row }]}>
          <AppText variant="heading" style={styles.flex}>
            {t("ride.meetAtPickup")}
          </AppText>
          {minutes ? (
            <AppText variant="heading" tone="accent" testID="ride-eta">
              {t("ride.etaMinutes", { minutes })}
            </AppText>
          ) : null}
        </View>
        <DriverCard driver={driver} />
        <EstimateFooter
          ride={ride}
          trailing={
            <OutlineAction
              label={t("ride.cancelRide")}
              onPress={openCancel}
              testID="ride-cancel"
            />
          }
        />
      </BottomSheet>
    );
  } else if (ride.state === "driver_arrived" && driver) {
    const graceEndMs = ride.waitGraceEndsAt
      ? Date.parse(ride.waitGraceEndsAt)
      : null;
    const graceLeft =
      graceEndMs !== null ? Math.max(0, (graceEndMs - now) / 1000) : null;
    // PRC-03 wait charge (M8, approved artboard RiderWaitCharge): once the
    // grace ends the charge accrues per minute. The per-minute rate comes
    // from the region config when it carries one; the client-side amount is
    // a courtesy preview — the authoritative value arrives with the fare.
    const charging = graceEndMs !== null && now >= graceEndMs;
    const waitRate = region?.config?.waitPerMinRate ?? null;
    const waitCurrency = ride.estimate.components.currency;
    const chargedMinutes = charging
      ? Math.floor((now - (graceEndMs as number)) / 60_000)
      : 0;
    const minuteProgress = charging
      ? ((now - (graceEndMs as number)) % 60_000) / 60_000
      : 0;
    const graceMinutes = (() => {
      const arrivedAt = ride.timeline.driverArrivedAt
        ? Date.parse(ride.timeline.driverArrivedAt)
        : Number.NaN;
      if (graceEndMs !== null && !Number.isNaN(arrivedAt)) {
        return Math.max(0, Math.round((graceEndMs - arrivedAt) / 60_000));
      }
      return region?.config?.waitGraceMin ?? 5;
    })();
    sheet = (
      <BottomSheet testID="ride-arrived">
        <View style={styles.titleBlock}>
          <AppText variant="title">{t("ride.arrivedTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {t("ride.arrivedBody", {
              name: driver.firstName,
              place: placeLabel(ride.pickup),
            })}
          </AppText>
        </View>
        {charging ? (
          <View style={styles.waitCharge} testID="ride-wait-charge">
            <View style={[styles.waitChargeHead, { flexDirection: row }]}>
              <Ionicons name="time-outline" size={20} color={colors.warning} />
              <AppText
                variant="bodyStrong"
                weight={800}
                tone="warning"
                style={styles.flex}
              >
                {t("ride.waitChargeTitle")}
              </AppText>
              {waitRate !== null ? (
                <AppText
                  variant="bodyStrong"
                  weight={800}
                  tone="warning"
                  testID="ride-wait-charge-amount"
                >
                  {formatMoney(
                    chargedMinutes * waitRate,
                    waitCurrency,
                    locale,
                    t,
                  )}
                </AppText>
              ) : null}
            </View>
            <View style={styles.waitBar}>
              <View
                style={[
                  styles.waitBarFill,
                  { width: `${Math.round(minuteProgress * 100)}%` },
                ]}
              />
            </View>
            <AppText variant="caption" tone="warning" weight={400}>
              {waitRate !== null
                ? t("ride.waitChargeBody", {
                    minutes: graceMinutes,
                    time: formatClock(graceEndMs as number, locale),
                    money: formatMoney(waitRate, waitCurrency, locale, t),
                  })
                : t("ride.waitChargeBodyNoRate", {
                    time: formatClock(graceEndMs as number, locale),
                  })}
            </AppText>
          </View>
        ) : graceLeft !== null ? (
          <View style={[styles.waitBox, { flexDirection: row }]}>
            <Ionicons name="time-outline" size={20} color={colors.accent} />
            <AppText variant="bodyStrong" style={styles.flex} tone="accent">
              {t("ride.freeWaiting")}
            </AppText>
            <AppText variant="heading" tone="accent" testID="ride-wait-countdown">
              {formatCountdown(graceLeft)}
            </AppText>
          </View>
        ) : null}
        <DriverCard driver={driver} />
        <EstimateFooter
          ride={ride}
          trailing={
            <OutlineAction
              label={t("ride.cancelRide")}
              onPress={openCancel}
              testID="ride-cancel"
            />
          }
        />
      </BottomSheet>
    );
  } else if (ride.state === "in_progress") {
    const arriveAt =
      facade.etaSeconds != null
        ? formatClock(now + facade.etaSeconds * 1000, locale)
        : null;
    const details = [
      arriveAt ? t("ride.arriveAbout", { time: arriveAt }) : null,
      driver?.firstName ?? null,
      driver
        ? t("ride.vehicle", {
            color: driver.vehicle.color,
            make: driver.vehicle.make,
            model: driver.vehicle.model,
          })
        : null,
    ].filter(Boolean);
    sheet = (
      <BottomSheet testID="ride-in-progress">
        <View style={[styles.headline, { flexDirection: row }]}>
          <AppText variant="heading" style={styles.flex}>
            {t("ride.onTheWay")}
          </AppText>
          {minutes ? (
            <AppText variant="heading" tone="accent" testID="ride-eta">
              {t("ride.etaMinutes", { minutes })}
            </AppText>
          ) : null}
        </View>
        {details.length ? (
          <AppText variant="secondary" tone="secondary">
            {details.join(" · ")}
          </AppText>
        ) : null}
        <RouteColumn
          pickup={ride.pickup}
          stops={ride.stops}
          destination={ride.destination}
          showPickup={false}
        />
        <View style={[styles.twoButtons, { flexDirection: row }]}>
          <SecondaryButton
            label={t("ride.changeDestination")}
            onPress={() => router.push("/change-route")}
            style={styles.flex1}
            testID="ride-change-destination"
          />
          {ride.stops.length < 3 ? (
            <SecondaryButton
              label={t("ride.addStop")}
              onPress={() => router.push("/change-route?focus=stop" as never)}
              style={styles.flex1}
              testID="ride-add-stop"
            />
          ) : null}
        </View>
        <EstimateFooter ride={ride} metered />
      </BottomSheet>
    );
  } else if (
    ride.state === "cancelled_by_rider" ||
    ride.state === "cancelled_by_driver"
  ) {
    // Ended without a re-dispatch: rider cancelled, or a rider no-show.
    const fee = ride.cancellationFee;
    sheet = (
      <BottomSheet testID="ride-ended">
        <IconWell name="close" />
        <View style={styles.titleBlock}>
          <AppText variant="title">
            {ride.state === "cancelled_by_driver"
              ? t("ride.cancelledByDriverTitle")
              : t("ride.cancelledByRiderTitle")}
          </AppText>
          {ride.cancellationReason === "rider_no_show" ? (
            <AppText variant="body" tone="secondary">
              {t("ride.noShowBody")}
            </AppText>
          ) : null}
          <AppText variant="body" tone="secondary" testID="ride-ended-fee">
            {fee != null && fee > 0
              ? t("ride.feeRecorded", {
                  money: formatMoney(
                    fee,
                    ride.estimate.components.currency,
                    locale,
                    t,
                  ),
                })
              : t("ride.notCharged")}
          </AppText>
        </View>
        <PrimaryButton label={t("ride.done")} onPress={done} testID="ride-done" />
      </BottomSheet>
    );
  } else {
    // A view the contract never sends (e.g. accepted without a driver):
    // wait for the next frame / resync.
    sheet = (
      <BottomSheet testID="ride-syncing">
        <LoadingView />
      </BottomSheet>
    );
  }

  const showDriver =
    ride.state === "accepted" ||
    ride.state === "driver_arrived" ||
    ride.state === "in_progress";

  return (
    <MapScreen
      testID="ride-view"
      map={
        <View style={styles.flex}>
          <RideMap
            pickup={ride.pickup}
            stops={ride.stops}
            destination={ride.destination}
            driver={showDriver ? facade.driverPosition : null}
            noticeTop={top + FLOATING_CLEARANCE}
          />
          {lost ? (
            <View style={[styles.lostBanner, { top: top + spacing.sm }]}>
              <Banner
                tone="warning"
                message={t("ride.connectionLost")}
                testID="ride-connection-lost"
              />
            </View>
          ) : null}
        </View>
      }
      floating={
        ride.state === "no_driver_found" ? (
          <MapFab
            icon="close"
            accessibilityLabel={t("ride.close")}
            onPress={done}
            testID="ride-close"
          />
        ) : null
      }
      sheet={
        <>
          {sheet}
          {cancellable && cancelOpen ? (
            <CancelSheet
              ride={ride}
              visible={cancelOpen}
              onClose={() => setCancelOpen(false)}
            />
          ) : null}
        </>
      }
    />
  );
}

/** The estimate lines inside the finding box (no top divider). */
function EstimateFooterInline({ ride }: { ride: Ride }) {
  const { t, locale } = useLocale();
  const money = formatMoney(
    ride.estimate.components.total,
    ride.estimate.components.currency,
    locale,
    t,
  );
  return (
    <View style={styles.inlineEstimate}>
      <AppText variant="caption" tone="muted" weight={400}>
        {ridePaymentLine(ride, locale, t)}
      </AppText>
      <AppText variant="bodyStrong" weight={800} testID="ride-estimate">
        {ride.estimate.approximate
          ? t("ride.approximateAmount", { money })
          : t("ride.estimateAmount", { money })}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  completeContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  titleBlock: {
    gap: 6,
  },
  cashBox: {
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  bigAmount: {
    fontSize: 40,
  },
  dividerTop: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  actions: {
    gap: 10,
  },
  flex: {
    flex: 1,
  },
  flex1: {
    flex: 1,
    alignSelf: "auto",
  },
  flex2: {
    flex: 2,
    alignSelf: "auto",
  },
  estimateBox: {
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: spacing.md,
  },
  inlineEstimate: {
    gap: 2,
  },
  tripBox: {
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    gap: spacing.xs,
  },
  hint: {
    alignItems: "center",
    gap: 10,
    minHeight: 48,
  },
  twoButtons: {
    gap: 10,
  },
  headline: {
    alignItems: "baseline",
    gap: spacing.md,
  },
  waitBox: {
    backgroundColor: colors.accentTint,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: spacing.md,
  },
  waitCharge: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.lg,
    padding: 14,
    gap: 10,
  },
  waitChargeHead: {
    alignItems: "center",
    gap: 10,
  },
  // Track/fill amber per the approved RiderWaitCharge artboard.
  waitBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F2E3C4",
    overflow: "hidden",
  },
  waitBarFill: {
    height: "100%",
    backgroundColor: "#D97706",
  },
  splitRow: {
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  pill: {
    alignSelf: "auto",
    height: 48,
    borderRadius: radius.round,
    paddingHorizontal: spacing.lg,
  },
  lostBanner: {
    position: "absolute",
    start: spacing.lg,
    end: spacing.lg,
  },
});
