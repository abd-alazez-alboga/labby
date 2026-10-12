import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { getTripEarnings } from "../../api/money";
import type { TripEarning } from "../../api/money-types";
import type { Ride } from "../../api/ride-types";
import {
  formatAmountValue,
  formatMoney,
  formatSignedMoney,
  isolateDigits,
} from "../../money/format";
import { useOptionalDriverMoney } from "../../money/DriverMoneyProvider";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { formatDistance, formatMinutes } from "../../rides/format";
import { colors, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  FailureState,
  Icon,
  LoadingState,
  PrimaryButton,
  SafeScrollView,
  SecondaryButton,
  TextButton,
  useDirection,
  useSafeBottomBar,
} from "../ui";
import { FareLine } from "../ride/ride-parts";

/** Secondary text on the near-black card. */
const ON_DARK_MUTED = colors.lineStrong;

type Load =
  | { status: "loading" }
  | { status: "loaded"; earning: TripEarning }
  /** The page answered but the ride's entry is not posted yet. */
  | { status: "missing" }
  | { status: "error"; kind: FailureKind };

/**
 * UC-D-15 — the per-trip earnings breakdown shown after the payment of a
 * completed ride settles (artboard "Driver Trip earnings"): the dark
 * collected/credited card, fare / commission / tip lines, the signed
 * balance change, the running balance, and the cash-debt explainer. The
 * itemization comes from `GET /driver/earnings` (COM-01) — never computed.
 */
export function TripEarningsScreen({
  ride,
  onDone,
}: {
  ride: Ride;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { flipRows, language } = useDirection();
  const router = useRouter();
  const bottom = useSafeBottomBar();
  const money = useOptionalDriverMoney();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const moneyReload = money?.reload;
  const fetchEarning = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const [page] = await Promise.all([
        getTripEarnings(0, 20),
        // Refresh "Balance now" alongside (quiet; provider keeps last view).
        moneyReload ? moneyReload() : Promise.resolve(),
      ]);
      if (!mounted.current) return;
      const earning = page.items.find((item) => item.rideId === ride.id);
      setLoad(earning ? { status: "loaded", earning } : { status: "missing" });
    } catch (caught) {
      if (mounted.current)
        setLoad({ status: "error", kind: failureKindOf(caught) });
    }
  }, [moneyReload, ride.id]);

  useEffect(() => {
    void fetchEarning();
  }, [fetchEarning]);

  const earning = load.status === "loaded" ? load.earning : null;
  const currency = earning?.currency ?? ride.fare?.components.currency ?? "";
  const name = ride.rider?.firstName?.trim() || t("ride.theRider");
  const service =
    language === "ar" ? ride.serviceTypeNameAr : ride.serviceTypeNameEn;
  const mixed = ride.paymentStatus === "paid_mixed";
  const cash = ride.paymentStatus === "paid_cash" || mixed;

  // The dark card: what the driver collected in cash (the server's
  // `cashDue` — fare cash part + carried cash fees, W6), or what was
  // credited. The fare total is only a fallback when cashDue is absent.
  const fareTotal = earning?.fareTotal ?? ride.fare?.components.total ?? null;
  // Carried fees the driver took in cash with this fare (pass-through: the
  // card's cashDue includes them, so each is itemized under the fare).
  const cashDues = cash
    ? (ride.carriedDues ?? []).filter((due) => due.method === "cash")
    : [];
  const cardAmount = cash
    ? (ride.cashDue ?? fareTotal)
    : (earning ? earning.net : null);
  const metaParts: string[] = [];
  if (ride.fare) {
    metaParts.push(
      formatDistance(t, ride.fare.distanceMeters, language),
      formatMinutes(t, ride.fare.durationSeconds, language),
    );
  }
  metaParts.push(service);
  metaParts.push(t(cash ? "tripEarnings.cashRide" : "tripEarnings.walletRide"));

  const fareLabel = mixed
    ? t("tripEarnings.fareMixed")
    : cash
      ? t("tripEarnings.fareCash")
      : t("tripEarnings.fareWallet");

  const balanceNow =
    money?.balance?.balances.find((entry) => entry.currency === currency) ??
    null;

  return (
    <View style={styles.screen} testID="trip-earnings-screen">
      <SafeScrollView safeTop contentContainerStyle={styles.content} bounces={false}>
        <AppText variant="rowTitle" color={colors.textSecondary} testID="trip-earnings-title">
          {t("ride.complete.title", { name })}
        </AppText>

        <View style={styles.card} testID="trip-earnings-card">
          <AppText variant="rowTitle" color={ON_DARK_MUTED}>
            {t(cash ? "tripEarnings.collectedCash" : "tripEarnings.credited")}
          </AppText>
          <AppText style={styles.total} color={colors.onAccent} testID="trip-earnings-total">
            {cardAmount !== null
              ? cash
                ? formatMoney(cardAmount, currency, language)
                : formatSignedMoney(cardAmount, currency, language, { alwaysSign: true })
              : "—"}
          </AppText>
          <AppText variant="secondary" color={ON_DARK_MUTED}>
            {metaParts.join(" · ")}
          </AppText>
        </View>

        {load.status === "loading" ? (
          <LoadingState testID="trip-earnings-loading" label={t("tripEarnings.pending")} />
        ) : null}
        {load.status === "error" ? (
          <FailureState
            kind={load.kind}
            onRetry={() => void fetchEarning()}
            testID="trip-earnings-error"
          />
        ) : null}
        {load.status === "missing" ? (
          <Banner tone="neutral" message={t("tripEarnings.missing")} testID="trip-earnings-missing">
            <SecondaryButton
              title={t("onboarding.actions.retry")}
              icon="refresh"
              onPress={() => void fetchEarning()}
              testID="trip-earnings-retry"
            />
          </Banner>
        ) : null}

        {earning ? (
          <>
            <View testID="trip-earnings-lines">
              <FareLine
                label={fareLabel}
                value={formatMoney(earning.fareTotal, currency, language)}
                testID="earning-line-fare"
              />
              {mixed && ride.walletApplied ? (
                <FareLine
                  label={t("tripEarnings.walletApplied")}
                  value={formatMoney(ride.walletApplied, currency, language)}
                  testID="earning-line-wallet"
                />
              ) : null}
              {cashDues.map((due) => (
                <FareLine
                  key={due.dueId}
                  label={t("ride.complete.carriedFee")}
                  value={formatMoney(due.amount, due.currency, language)}
                  testID={`earning-line-carried-${due.dueId}`}
                />
              ))}
              <FareLine
                label={t("tripEarnings.commission", {
                  rate: isolateDigits(
                    `${formatAmountValue(earning.commissionRate)}%`,
                    language,
                  ),
                })}
                value={formatSignedMoney(-earning.commissionAmount, currency, language)}
                testID="earning-line-commission"
              />
              {earning.tip ? (
                <FareLine
                  label={t("tripEarnings.tipFrom", { name })}
                  value={formatSignedMoney(earning.tip, currency, language, { alwaysSign: true })}
                  valueColor={colors.accent}
                  testID="earning-line-tip"
                />
              ) : null}
              {earning.cancellationFee ? (
                <FareLine
                  label={t("tripEarnings.fee")}
                  value={formatSignedMoney(earning.cancellationFee, currency, language, { alwaysSign: true })}
                  valueColor={colors.accent}
                  testID="earning-line-fee"
                />
              ) : null}
              <View style={styles.netLine}>
                <FareLine
                  label={t("tripEarnings.balanceChange")}
                  value={formatSignedMoney(earning.net, currency, language, { alwaysSign: true })}
                  testID="earning-line-net"
                />
              </View>
              {balanceNow ? (
                <FareLine
                  label={t("tripEarnings.balanceNow")}
                  value={formatSignedMoney(balanceNow.balance, currency, language)}
                  valueColor={colors.textMuted}
                  testID="earning-line-balance"
                />
              ) : null}
            </View>

            <View
              style={[styles.explainer, flipRows && styles.rowReverse]}
              testID="trip-earnings-explainer"
            >
              <Icon name="information-circle-outline" size={20} />
              <AppText variant="caption" weight="400" color={colors.textSecondary} style={styles.explainerText}>
                {t(cash ? "tripEarnings.cashExplainer" : "tripEarnings.walletExplainer")}
              </AppText>
            </View>
          </>
        ) : null}
      </SafeScrollView>

      <View style={[styles.footer, { paddingBottom: bottom }]}>
        <PrimaryButton
          title={t("tripEarnings.done")}
          size="large"
          onPress={onDone}
          testID="trip-earnings-done"
        />
        <TextButton
          title={t("tripEarnings.seeWeek")}
          onPress={() => {
            onDone();
            router.push("/earnings");
          }}
          testID="trip-earnings-see-week"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  rowReverse: { flexDirection: "row-reverse" },
  content: {
    paddingTop: spacing.xl + spacing.sm,
    paddingHorizontal: spacing.ml,
    gap: 18,
  },
  card: {
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
  netLine: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: spacing.xs,
  },
  explainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.surfaceFill,
    borderRadius: 14,
    paddingVertical: spacing.ms,
    paddingHorizontal: 14,
  },
  explainerText: { flex: 1 },
  footer: {
    paddingHorizontal: spacing.ml,
    paddingTop: spacing.ms,
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
});
