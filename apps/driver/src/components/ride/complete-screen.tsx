import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import type { FareComponents, Ride } from "../../api/ride-types";
import type { DriverRideContextValue } from "../../rides/DriverRideProvider";
import {
  formatDistance,
  formatMinutes,
  formatMoney,
  formatNumber,
} from "../../rides/format";
import { colors, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  OutlineButton,
  PrimaryButton,
  SafeScrollView,
  useDirection,
  useSafeBottomBar,
} from "../ui";
import { FareLine } from "./ride-parts";

/** Secondary text on the near-black cash card. */
const ON_DARK_MUTED = colors.lineStrong;

interface Line {
  key: string;
  label: string;
  amount: number;
}

/**
 * The STORED fare's lines (PRC-04) — base, distance, time always; every
 * other component only when it is not zero. Amounts come straight from the
 * response; nothing is added up or recomputed here.
 */
function fareLines(
  t: ReturnType<typeof useTranslation>["t"],
  components: FareComponents,
  ride: Ride,
  language: string,
): Line[] {
  const fare = ride.fare;
  const lines: Line[] = [
    { key: "base", label: t("ride.fare.base"), amount: components.baseFare },
    {
      key: "distance",
      label: fare
        ? t("ride.fare.distanceWith", {
            distance: formatDistance(t, fare.distanceMeters, language),
          })
        : t("ride.fare.distance"),
      amount: components.distanceFare,
    },
    {
      key: "time",
      label: fare
        ? t("ride.fare.timeWith", {
            time: formatMinutes(t, fare.durationSeconds, language),
          })
        : t("ride.fare.time"),
      amount: components.timeFare,
    },
  ];
  const optional: Line[] = [
    {
      key: "surcharge",
      label: t("ride.fare.surcharge", {
        percent: formatNumber(components.surchargePercent, language, 2),
      }),
      amount: components.surchargeAmount,
    },
    {
      key: "surge",
      label: t("ride.fare.surge", {
        multiplier: formatNumber(components.surgeMultiplier, language, 2),
      }),
      amount: components.surgeAmount,
    },
    { key: "wait", label: t("ride.fare.wait"), amount: components.waitFare },
    {
      key: "pickupFee",
      label: t("ride.fare.pickupFee"),
      amount: components.pickupFee,
    },
    {
      key: "minimum",
      label: t("ride.fare.minimumAdjustment"),
      amount: components.minimumFareAdjustment,
    },
    {
      key: "discount",
      label: t("ride.fare.discount"),
      amount: -components.discount,
    },
  ];
  return [...lines, ...optional.filter((line) => line.amount !== 0)];
}

/**
 * Design canvas "Driver complete" (UC-D-09): "Collect SYP X in cash" from
 * the stored fare, its components, big "Cash received" (cash-confirm) and
 * "Rider didn't pay" (mark-unpaid, E1). Cash only in M7.
 */
export function CompleteScreen({
  ctx,
  ride,
}: {
  ctx: DriverRideContextValue;
  ride: Ride;
}) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const bottom = useSafeBottomBar();
  const fare = ride.fare;
  const name = ride.rider?.firstName?.trim() || t("ride.theRider");
  const busy = ctx.pending !== null;
  const error =
    ctx.error?.action === "cashConfirm" || ctx.error?.action === "markUnpaid"
      ? ctx.error
      : null;
  const service =
    language === "ar" ? ride.serviceTypeNameAr : ride.serviceTypeNameEn;

  return (
    <View style={styles.screen} testID="ride-complete-screen">
      <SafeScrollView
        safeTop
        contentContainerStyle={styles.content}
        bounces={false}
      >
        <AppText
          variant="rowTitle"
          color={colors.textSecondary}
          testID="complete-title"
        >
          {t("ride.complete.title", { name })}
        </AppText>

        {fare ? (
          <>
            <View style={styles.cashCard} testID="collect-card">
              <AppText variant="rowTitle" color={ON_DARK_MUTED}>
                {t("ride.complete.collectCash")}
              </AppText>
              <AppText
                style={styles.total}
                color={colors.onAccent}
                testID="collect-total"
              >
                {formatMoney(
                  t,
                  fare.components.total,
                  fare.components.currency,
                  language,
                )}
              </AppText>
              <AppText variant="secondary" color={ON_DARK_MUTED}>
                {[
                  formatDistance(t, fare.distanceMeters, language),
                  formatMinutes(t, fare.durationSeconds, language),
                  service,
                ].join(" · ")}
              </AppText>
            </View>

            <View testID="fare-breakdown">
              {fareLines(t, fare.components, ride, language).map((line) => (
                <FareLine
                  key={line.key}
                  label={line.label}
                  value={formatMoney(
                    t,
                    line.amount,
                    fare.components.currency,
                    language,
                  )}
                  testID={`fare-line-${line.key}`}
                />
              ))}
            </View>
          </>
        ) : (
          <Banner
            tone="neutral"
            message={t("ride.complete.fareMissing")}
            testID="fare-missing"
          />
        )}
      </SafeScrollView>

      <View style={[styles.footer, { paddingBottom: bottom }]}>
        {error ? (
          <Banner
            tone="danger"
            message={t(`ride.errors.${error.kind}`)}
            testID="settle-error"
          />
        ) : null}
        <PrimaryButton
          title={t("ride.complete.cashReceived")}
          icon="cash-outline"
          size="hero"
          onPress={() => void ctx.confirmCash()}
          disabled={busy}
          busy={ctx.pending === "cashConfirm"}
          testID="cash-received"
        />
        <OutlineButton
          title={t("ride.complete.riderDidNotPay")}
          onPress={() => void ctx.markUnpaid()}
          disabled={busy}
          busy={ctx.pending === "markUnpaid"}
          testID="mark-unpaid"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: {
    paddingTop: spacing.xl + spacing.sm,
    paddingHorizontal: spacing.ml,
    gap: 18,
  },
  cashCard: {
    backgroundColor: colors.text,
    borderRadius: 20,
    padding: spacing.ml,
    gap: 6,
  },
  total: {
    fontSize: 46,
    lineHeight: 54,
    fontWeight: "800",
  },
  footer: {
    paddingHorizontal: spacing.ml,
    paddingTop: spacing.ms,
    gap: spacing.ms,
    backgroundColor: colors.surface,
  },
});
