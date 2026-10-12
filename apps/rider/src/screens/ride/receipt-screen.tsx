/**
 * Receipt (UC-R-07 step 4, PRC-04) — approved artboards RiderReceipt and
 * RiderReceiptSplit: the route map drawn from `receipt.route` (the in_ride
 * trace), timestamps, the STORED fare components (never recomputed), the
 * payment status, and (M8) the "How you paid" box when the payment was
 * split across wallet / cash / the itemized carried dues (rows shared with
 * the ride-complete screen) — plus the tip line, and a
 * "Tip <driver>" entry while the 24 h window is open and no tip exists.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { failureKind, type FailureKind } from "../../api/http-client";
import { getReceipt, type Receipt } from "../../api/rides";
import { type TipResponse, withinTipWindow } from "../../api/wallet";
import {
  AppText,
  ErrorView,
  LoadingView,
  MapFab,
  ScreenScrollView,
  TextButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { paymentRows } from "../../ride/money-math";
import {
  formatClock,
  formatDateTime,
  formatMoney,
  serviceName,
} from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { TipSheet } from "../wallet/tip-sheet";
import {
  FareBreakdown,
  paymentRowLabel,
  RideMap,
  RouteColumn,
} from "./ride-parts";

export default function ReceiptScreen({ rideId }: { rideId: string }) {
  const { t, locale } = useLocale();
  const { row, backChevron, flipRows } = useDirection();
  const { top } = useSafeAreaInsets();
  const router = useRouter();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipSent, setTipSent] = useState<TipResponse | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      setReceipt(await getReceipt(rideId));
    } catch (error) {
      setFailure(failureKind(error));
    }
  }, [rideId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (failure) return <ErrorView kind={failure} onRetry={() => void load()} />;
  if (!receipt) return <LoadingView testID="receipt-loading" />;

  const service = serviceName(
    { nameEn: receipt.serviceTypeNameEn, nameAr: receipt.serviceTypeNameAr },
    locale,
  );
  const subtitle = [
    service,
    receipt.driver?.firstName,
    receipt.driver
      ? t("ride.vehicle", {
          color: receipt.driver.vehicle.color,
          make: receipt.driver.vehicle.make,
          model: receipt.driver.vehicle.model,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const { startedAt, completedAt, requestedAt } = receipt.timeline;
  const paymentLabel =
    receipt.paymentStatus === "paid_cash"
      ? t("receipt.paidCash")
      : receipt.paymentStatus === "paid_wallet"
        ? t("receipt.paidWallet")
        : receipt.paymentStatus === "paid_mixed"
          ? t("receipt.paidMixed")
          : receipt.paymentStatus === "unpaid"
            ? t("receipt.unpaid")
            : t("receipt.pending");
  const paid =
    receipt.paymentStatus === "paid_cash" ||
    receipt.paymentStatus === "paid_wallet" ||
    receipt.paymentStatus === "paid_mixed";

  // PAY-02 split (M8): wallet part, the fare's cash remainder and the
  // itemized carried dues — the same rows as the ride-complete screen.
  const currency = receipt.fare.components.currency;
  const total = receipt.fare.components.total;
  const splitRows = paymentRows(receipt);
  const tipAmount = tipSent?.amount ?? receipt.tip ?? null;
  const hasPaidBox = splitRows.length > 0 || tipAmount !== null;
  const canTip =
    !!receipt.driver && tipAmount === null && withinTipWindow(completedAt);
  const money = (amount: number) => formatMoney(amount, currency, locale, t);

  return (
    <ScreenScrollView style={styles.page} testID="receipt-screen">
      <View style={styles.map}>
        <RideMap
          pickup={receipt.pickup}
          stops={receipt.stops}
          destination={receipt.destination}
          route={receipt.route}
          noticeTop={top + 72}
          testID="receipt-map"
        />
        <View
          style={[
            styles.back,
            { top: top + spacing.sm },
            flipRows ? styles.backRtl : styles.backLtr,
          ]}
        >
          <MapFab
            icon={backChevron}
            accessibilityLabel={t("common.back")}
            onPress={() => router.back()}
            testID="receipt-back"
          />
        </View>
      </View>
      <View style={styles.content}>
        <View style={styles.titleBlock}>
          <AppText variant="heading" testID="receipt-date">
            {formatDateTime(startedAt ?? requestedAt, locale)}
          </AppText>
          <AppText variant="caption" tone="secondary" weight={400}>
            {subtitle}
          </AppText>
        </View>
        <RouteColumn
          pickup={receipt.pickup}
          stops={receipt.stops}
          destination={receipt.destination}
          trailing={{
            pickup: startedAt ? formatClock(startedAt, locale) : undefined,
            dropoff: completedAt ? formatClock(completedAt, locale) : undefined,
          }}
          testID="receipt-route"
        />
        <View style={styles.divider}>
          <FareBreakdown
            components={receipt.fare.components}
            measured={receipt.fare}
            testID="receipt-fare"
          />
        </View>
        {hasPaidBox ? (
          // Approved artboard RiderReceiptSplit: "How you paid".
          <View style={styles.paidBox} testID="receipt-paid-box">
            <AppText variant="secondary" weight={800}>
              {t("ride.howYouPaid")}
            </AppText>
            {splitRows.map((line, index) => {
              const strong = line.kind === "handed";
              const firstDue =
                line.kind === "due" && splitRows[index - 1]?.kind !== "due";
              return (
                <View
                  key={line.key}
                  style={[
                    styles.paidLine,
                    firstDue && styles.paidDivider,
                    { flexDirection: row },
                  ]}
                  testID={`receipt-paid-${line.key}`}
                >
                  {line.kind === "wallet" ? (
                    <Ionicons name="wallet-outline" size={16} color={colors.accent} />
                  ) : null}
                  <AppText
                    variant="secondary"
                    tone={strong ? "default" : "secondary"}
                    weight={strong ? 800 : 400}
                    style={styles.flex}
                  >
                    {paymentRowLabel(line, t)}
                  </AppText>
                  <AppText variant="secondary" weight={strong ? 800 : 700}>
                    {money(line.amount)}
                  </AppText>
                </View>
              );
            })}
            {tipAmount !== null ? (
              <View
                style={[styles.paidLine, { flexDirection: row }]}
                testID="receipt-paid-tip"
              >
                <Ionicons name="heart-outline" size={16} color={colors.accent} />
                <AppText variant="secondary" tone="secondary" style={styles.flex}>
                  {t("ride.tipLine")}
                </AppText>
                <AppText variant="secondary" weight={700}>
                  {money(tipAmount)}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}
        <View
          style={[styles.payment, { flexDirection: row }]}
          testID="receipt-payment-row"
        >
          <Ionicons
            name={receipt.paymentMethod === "wallet" ? "wallet-outline" : "cash-outline"}
            size={22}
            color={colors.text}
          />
          <AppText
            variant="bodyStrong"
            style={styles.flex}
            testID="receipt-payment"
          >
            {paymentLabel}
          </AppText>
          {paid ? (
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          ) : null}
          {canTip && receipt.driver ? (
            <TextButton
              label={t("tip.title", { name: receipt.driver.firstName })}
              onPress={() => setTipOpen(true)}
              testID="receipt-tip"
            />
          ) : null}
        </View>
      </View>
      {canTip && receipt.driver ? (
        <TipSheet
          visible={tipOpen}
          onClose={() => setTipOpen(false)}
          rideId={receipt.rideId}
          currency={currency}
          driverName={receipt.driver.firstName}
          completedAt={completedAt ?? null}
          rideLine={`${formatDateTime(startedAt ?? requestedAt, locale)} · ${money(total)}`}
          onTipped={setTipSent}
        />
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  map: {
    height: 250,
  },
  back: {
    position: "absolute",
  },
  backLtr: {
    start: spacing.lg,
  },
  backRtl: {
    end: spacing.lg,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  titleBlock: {
    gap: 2,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 6,
  },
  payment: {
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  paidBox: {
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.lg,
    padding: 14,
    gap: 10,
  },
  paidLine: {
    alignItems: "center",
    gap: spacing.sm,
  },
  paidDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.lineStrong,
    paddingTop: 10,
  },
  flex: {
    flex: 1,
  },
});
