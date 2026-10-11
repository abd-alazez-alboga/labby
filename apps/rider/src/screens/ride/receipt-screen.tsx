/**
 * Receipt (UC-R-07 step 4, PRC-04) — approved artboard RiderReceipt: the
 * route map drawn from `receipt.route` (the in_ride trace), timestamps, the
 * STORED fare components (never recomputed) and the payment status.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { failureKind, type FailureKind } from "../../api/http-client";
import { getReceipt, type Receipt } from "../../api/rides";
import {
  AppText,
  ErrorView,
  LoadingView,
  MapFab,
  ScreenScrollView,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import {
  formatClock,
  formatDateTime,
  serviceName,
} from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { FareBreakdown, RideMap, RouteColumn } from "./ride-parts";

export default function ReceiptScreen({ rideId }: { rideId: string }) {
  const { t, locale } = useLocale();
  const { row, backChevron, flipRows } = useDirection();
  const { top } = useSafeAreaInsets();
  const router = useRouter();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);

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
      : receipt.paymentStatus === "unpaid"
        ? t("receipt.unpaid")
        : t("receipt.pending");

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
        <View style={[styles.payment, { flexDirection: row }]}>
          <Ionicons name="cash-outline" size={22} color={colors.text} />
          <AppText
            variant="bodyStrong"
            style={styles.flex}
            testID="receipt-payment"
          >
            {paymentLabel}
          </AppText>
          {receipt.paymentStatus === "paid_cash" ? (
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          ) : null}
        </View>
      </View>
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
  flex: {
    flex: 1,
  },
});
