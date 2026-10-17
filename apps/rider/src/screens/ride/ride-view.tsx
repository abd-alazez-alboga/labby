/**
 * The ride on screen, by state (UC-R-05…07, UC-R-09) — approved artboards:
 * - requested / offering            RiderFinding ("Finding your driver")
 * - cancelled_by_driver, re-dispatched → the same sheet, "Finding you
 *   another driver" (no rider action: the facade follows the new ride)
 * - no_driver_found                 RiderNoDriver (one-tap retry, edit trip);
 *   the retry expects the ride's locked multiplier and a 409
 *   `surge_changed` opens the price-changed sheet (RiderSurgeChanged,
 *   PRC-02) instead of locking a surge the rider never saw
 * - accepted                        RiderDriverOnWay (driver, plate, ETA,
 *   live position) — the M10 safety actions (chat / call / share trip +
 *   the SOS pill, RiderSafetyActions) are live on accepted…in_progress
 * - driver_arrived                  RiderArrived (free-waiting countdown)
 * - in_progress                     RiderInRide (stops, change destination /
 *   add stop, no cancel — UC-R-09 E1; "Tip <driver>" until tipped, PAY-04)
 * - completed                       RiderComplete (stored fare components,
 *   cash due)
 * - cancelled_by_rider / rider no-show: the recorded fee (or "not
 *   charged") and Done.
 * M12: a shared ride (kind `shared`) shows its chip (seats, own party),
 * "Leave ride" instead of cancel (the per-member leave, RiderSharedLeave),
 * no route changes (one destination), and the rider's own share with the
 * per-seat split when completed (RiderSharedReceipt); a scheduled ride the
 * system cancelled because the rider was busy says so (`rider_busy`).
 * The connection-lost banner shows whenever the driver's stream is lost.
 * Ratings never render (null until M11).
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  estimateRide,
  RIDER_CANCELLABLE_STATES,
  type Ride,
  rideErrorCode,
  rideErrorNumber,
} from "../../api/rides";
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
import { paymentRows, waitChargePreview } from "../../ride/money-math";
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
import { SharedLeaveSheet } from "../shared/shared-leave-sheet";
import { SharedSplit } from "../shared/shared-split";
import { CancelSheet } from "./cancel-sheet";
import {
  markColdStartChecked,
  markRatingPrompted,
} from "../../trust/rating-prompts";
import { useAccountSuspended } from "../../trust/suspension";
import { ratingRideLine, RatingView } from "../trust/rating-view";
import { SafetyActionsRow, SosConfirmSheet, SosPill } from "./safety-actions";
import { type SurgeChange, SurgeChangedSheet } from "./surge-changed-sheet";
import {
  DriverCard,
  EstimateFooter,
  FareBreakdown,
  IconWell,
  paymentRowLabel,
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
  const [sosOpen, setSosOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Retry answered 409 surge_changed: the price-changed sheet (null = closed).
  const [surgeChange, setSurgeChange] = useState<SurgeChange | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipSent, setTipSent] = useState<TipResponse | null>(null);
  // A 409 already_tipped: the ride carries a tip this view hasn't seen yet.
  const [alreadyTipped, setAlreadyTipped] = useState(false);
  // M11 post-ride rating prompt: answered or skipped in this view.
  const [ratingDone, setRatingDone] = useState(false);
  const accountSuspended = useAccountSuspended();
  const region = useOptionalRegion();

  const driver = ride.driver ?? null;
  // RATE-01 post-ride prompt — never for a suspended account (refused).
  const ratingPrompt =
    ride.state === "completed" &&
    !!ride.fare &&
    !!driver &&
    ride.myRating?.state === "pending" &&
    !ratingDone &&
    !accountSuspended;
  // At most one prompt per launch: this one counts as the cold-start one.
  useEffect(() => {
    if (ratingPrompt) markColdStartChecked();
  }, [ratingPrompt]);
  // PAY-04: one tip per ride — the recorded one or the one just sent.
  const tipAmount = tipSent?.amount ?? ride.tip ?? null;
  const name = serviceName(
    { nameEn: ride.serviceTypeNameEn, nameAr: ride.serviceTypeNameAr },
    locale,
  );
  const minutes = etaMinutes(facade.etaSeconds, locale);
  const cancellable = RIDER_CANCELLABLE_STATES.includes(ride.state);
  // M12: a member of a shared ride leaves it instead of cancelling it.
  const shared = ride.kind === "shared" ? (ride.shared ?? null) : null;
  const cancelLabel = shared ? t("shared.leaveRide") : t("ride.cancelRide");
  const sharedChip = shared ? (
    <View style={[styles.sharedChip, row === "row" ? styles.selfStart : styles.selfEnd]}>
      <AppText variant="caption" weight={800} tone="accent" testID="ride-shared-chip">
        {t("shared.chip", {
          taken: shared.seatsTaken,
          total: shared.totalSeats,
          party: shared.me?.partySize ?? 1,
        })}
      </AppText>
    </View>
  ) : null;
  const lost =
    facade.driverStream === "lost" &&
    (ride.state === "accepted" ||
      ride.state === "driver_arrived" ||
      ride.state === "in_progress");

  /**
   * 409 surge_changed on retry: nothing was created. The sheet compares the
   * total the rider was last shown with a fresh estimate of the same trip
   * and service; without one (estimate failed, service gone, or the zone
   * moved again) the comparison is hidden and only the multiplier shown.
   */
  const onRetrySurgeChanged = async (
    previous: number,
    previousTotal: number | null,
    reported: number | null,
  ) => {
    if (reported === null) {
      setSurgeChange(null);
      setRetryError(t("booking.errors.generic"));
      return;
    }
    let nextTotal: number | null = null;
    let zone: string | null = null;
    try {
      const refreshed = await estimateRide({
        pickup: ride.pickup,
        destination: ride.destination,
        stops: ride.stops,
      });
      zone = refreshed.surgeZoneName;
      if (refreshed.surgeMultiplier === reported) {
        nextTotal =
          refreshed.options.find(
            (item) => item.serviceTypeId === ride.serviceTypeId,
          )?.estimate.components.total ?? null;
      }
    } catch {
      nextTotal = null;
    }
    setSurgeChange({
      previous,
      next: reported,
      zone,
      serviceName: name,
      currency: ride.estimate.components.currency,
      previousTotal,
      nextTotal,
    });
  };

  /**
   * "Try again" (no sheet) expects the ride's locked multiplier; "Confirm"
   * on the sheet expects the multiplier it shows (PRC-02).
   */
  const retry = async (change: SurgeChange | null) => {
    const expected = change ? change.next : ride.surgeMultiplier;
    const shownTotal = change
      ? change.nextTotal
      : ride.estimate.components.total;
    setRetrying(true);
    setRetryError(null);
    try {
      await facade.retry(expected);
      setSurgeChange(null);
    } catch (error) {
      if (rideErrorCode(error) === "surge_changed") {
        await onRetrySurgeChanged(
          expected,
          shownTotal,
          rideErrorNumber(error, "surgeMultiplier"),
        );
      } else {
        setSurgeChange(null);
        setRetryError(rideErrorMessage(error, t));
      }
    } finally {
      setRetrying(false);
    }
  };

  const openCancel = () => setCancelOpen(true);
  const done = () => {
    facade.dismiss();
    onDone();
  };

  // ------------------------------------------- post-ride rating (M11)
  // RATE-01 / UC-S-17: right after completion the skippable rating screen
  // comes first (approved artboard RiderRate: Skip → RiderComplete).
  if (ratingPrompt && driver && ride.myRating) {
    return (
      <RatingView
        rideId={ride.id}
        driverName={driver.firstName}
        driverPhotoUrl={driver.photoUrl}
        rideLine={ratingRideLine(ride, locale, t)}
        windowEndsAt={ride.myRating.windowEndsAt}
        onDone={() => {
          void markRatingPrompted(ride.id);
          setRatingDone(true);
        }}
      />
    );
  }

  // ------------------------------------------------------------ completed
  if (ride.state === "completed" && ride.fare) {
    const fare = ride.fare;
    const completedAt = ride.timeline.completedAt;
    const currency = fare.components.currency;
    const total = fare.components.total;
    // PAY-02 split (M8): wallet part, the fare's cash remainder and the
    // itemized carried dues — the same rows as the receipt.
    const walletApplied = ride.walletApplied ?? 0;
    const splitRows = paymentRows(ride);
    // M12: a shared ride reads `split` — the member's own status counts.
    const paymentStatus =
      ride.paymentStatus === "split"
        ? (shared?.me?.paymentStatus ?? null)
        : ride.paymentStatus;
    const statusLabel =
      paymentStatus === "paid_cash"
        ? t("ride.paidCash")
        : paymentStatus === "paid_wallet"
          ? t("ride.paidWallet")
          : paymentStatus === "paid_mixed"
            ? t("ride.paidMixed")
            : paymentStatus === "unpaid"
              ? t("ride.unpaid")
              : walletApplied > 0
                ? t("ride.payRemainder")
                : t("ride.payCash");
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
            {formatMoney(shared?.me?.shareAmount ?? total, currency, locale, t)}
          </AppText>
          <AppText variant="caption" tone="muted" weight={400}>
            {t("ride.meteredSummary", {
              km: formatKm(fare.distanceMeters, locale),
              minutes: formatMinutes(fare.durationSeconds, locale),
            })}
          </AppText>
          {splitRows.map((line) => {
            const strong = line.kind === "handed";
            return (
              <View
                key={line.key}
                style={[styles.splitRow, { flexDirection: row }]}
                testID={`ride-paid-${line.key}`}
              >
                <AppText
                  variant="secondary"
                  tone="secondary"
                  weight={strong ? 800 : 400}
                  style={styles.flex}
                >
                  {paymentRowLabel(line, t)}
                </AppText>
                <AppText variant="secondary" weight={strong ? 800 : 700}>
                  {formatMoney(line.amount, currency, locale, t)}
                </AppText>
              </View>
            );
          })}
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
        {shared?.split ? <SharedSplit split={shared.split} me={shared.me} /> : null}
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

  // Accepted → in progress: the driver dot on the map and the M10 safety
  // actions (chat / call / share row + the SOS pill) are live.
  const showDriver =
    ride.state === "accepted" ||
    ride.state === "driver_arrived" ||
    ride.state === "in_progress";

  const inRideTip =
    ride.state === "in_progress" &&
    !!driver &&
    tipAmount === null &&
    !alreadyTipped;

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
        {sharedChip}
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
            label={shared ? t("shared.leaveRide") : t("ride.cancelRequest")}
            onPress={openCancel}
            testID="ride-cancel"
          />
        )}
      </BottomSheet>
    );
  } else if (ride.state === "no_driver_found" && ride.kind === "shared") {
    // M12 review W5 (owner ruling 2026-10-17): a shared ride ends here —
    // no retry; the member creates or joins another one.
    sheet = (
      <BottomSheet testID="ride-no-driver-shared">
        <IconWell name="car-outline" />
        <View style={styles.titleBlock}>
          <AppText variant="title">{t("shared.noDriverTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {t("shared.noDriverBody")}
          </AppText>
        </View>
        <PrimaryButton
          label={t("shared.findAnother")}
          onPress={() => router.replace("/shared" as never)}
          testID="ride-shared-find-another"
        />
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
            loading={retrying && !surgeChange}
            onPress={() => void retry(null)}
            style={styles.flex2}
            testID="ride-retry"
          />
        </View>
        <SurgeChangedSheet
          change={surgeChange}
          confirming={retrying}
          onConfirm={() => {
            if (surgeChange) void retry(surgeChange);
          }}
          onBack={() => setSurgeChange(null)}
        />
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
        {sharedChip}
        <DriverCard driver={driver} />
        <SafetyActionsRow ride={ride} />
        <EstimateFooter
          ride={ride}
          trailing={
            <OutlineAction
              label={cancelLabel}
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
    // grace ends the charge accrues at the per-minute rate, per second. The per-minute rate comes
    // from the region config when it carries one; the client-side amount is
    // a courtesy preview — the authoritative value arrives with the fare.
    const charging = graceEndMs !== null && now >= graceEndMs;
    const waitRate = region?.config?.waitPerMinRate ?? null;
    const waitCurrency = ride.estimate.components.currency;
    // Prorated per second, rounded like the backend (RideExtrasCalculator).
    const waitAmount =
      charging && waitRate !== null
        ? waitChargePreview(now - (graceEndMs as number), waitRate)
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
                  {formatMoney(waitAmount, waitCurrency, locale, t)}
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
        {sharedChip}
        <DriverCard driver={driver} />
        <SafetyActionsRow ride={ride} />
        <EstimateFooter
          ride={ride}
          trailing={
            <OutlineAction
              label={cancelLabel}
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
        {sharedChip}
        <SafetyActionsRow ride={ride} />
        <RouteColumn
          pickup={ride.pickup}
          stops={ride.stops}
          destination={ride.destination}
          showPickup={false}
        />
        {shared ? null : (
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
        )}
        {inRideTip && driver ? (
          // PAY-04 / UC-R-08: tipping is open during the ride too.
          <SecondaryButton
            label={t("tip.title", { name: driver.firstName })}
            onPress={() => setTipOpen(true)}
            testID="ride-tip-in-progress"
          />
        ) : null}
        {tipSent ? (
          <Banner tone="success" message={t("tip.sent")} testID="ride-tip-sent" />
        ) : null}
        {alreadyTipped && tipAmount === null ? (
          <Banner
            tone="neutral"
            message={t("tip.errors.alreadyTipped")}
            testID="ride-tip-already"
          />
        ) : null}
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
          <AppText variant="title" testID="ride-ended-title">
            {ride.cancellationReason === "account_suspended"
              ? t("suspended.rideCancelledTitle")
              : ride.cancellationReason === "rider_busy"
                ? t("scheduled.riderBusyTitle")
                : shared && shared.me?.status === "cancelled"
                  ? t("shared.leftTitle")
                  : shared && ride.state === "cancelled_by_rider"
                    ? t("shared.endedTitle")
                    : ride.state === "cancelled_by_driver"
                      ? t("ride.cancelledByDriverTitle")
                      : t("ride.cancelledByRiderTitle")}
          </AppText>
          {ride.cancellationReason === "rider_busy" ? (
            <AppText variant="body" tone="secondary" testID="ride-ended-rider-busy">
              {t("scheduled.riderBusyBody")}
            </AppText>
          ) : null}
          {shared &&
          ride.state === "cancelled_by_rider" &&
          shared.me?.status !== "cancelled" ? (
            <AppText variant="body" tone="secondary" testID="ride-ended-shared">
              {ride.cancellationReason === "shared_expired"
                ? t("shared.endedExpired")
                : shared.isCreator
                  ? t("shared.endedYou")
                  : t("shared.endedByCreator")}
            </AppText>
          ) : null}
          {ride.cancellationReason === "account_suspended" ? (
            <AppText variant="body" tone="secondary" testID="ride-ended-suspended">
              {t("suspended.rideCancelledBody")}
            </AppText>
          ) : null}
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
          {showDriver ? (
            <SosPill onPress={() => setSosOpen(true)} top={top + spacing.sm} />
          ) : null}
          {lost ? (
            <View
              style={[
                styles.lostBanner,
                // Below the SOS pill on the safety states.
                { top: top + spacing.sm + (showDriver ? 56 : 0) },
              ]}
            >
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
          {cancellable && cancelOpen && !shared ? (
            <CancelSheet
              ride={ride}
              visible={cancelOpen}
              onClose={() => setCancelOpen(false)}
            />
          ) : null}
          {cancellable && cancelOpen && shared ? (
            <SharedLeaveSheet
              ride={ride}
              visible={cancelOpen}
              onClose={() => setCancelOpen(false)}
            />
          ) : null}
          {showDriver && sosOpen ? (
            <SosConfirmSheet
              ride={ride}
              visible={sosOpen}
              onClose={() => setSosOpen(false)}
            />
          ) : null}
          {inRideTip ? (
            <TipSheet
              visible={tipOpen}
              onClose={() => setTipOpen(false)}
              rideId={ride.id}
              currency={ride.estimate.components.currency}
              driverName={driver?.firstName ?? null}
              completedAt={null}
              onTipped={setTipSent}
              onAlreadyTipped={() => setAlreadyTipped(true)}
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
  sharedChip: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  selfStart: {
    alignSelf: "flex-start",
  },
  selfEnd: {
    alignSelf: "flex-end",
  },
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
