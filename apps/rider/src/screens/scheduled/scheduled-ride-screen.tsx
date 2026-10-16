/**
 * One scheduled ride (UC-R-11) — approved artboard RiderSchedDetail: claim
 * status, the claiming driver once claimed, the route, service · payment ·
 * estimate "at ride time", the reminder note (24 h + 1 h, RIDE-S3), the
 * free-cancellation note (until the ride starts at T − 15 min) and "Cancel
 * scheduled ride" (RiderSchedCancel). Ride frames for this ride refresh it
 * (a claim / release); once it is no longer `scheduled` (converted, fallen
 * back, or cancelled by the system) the ride screen takes over.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { failureKind, type FailureKind } from "../../api/http-client";
import { getRide, type Ride } from "../../api/rides";
import { DEFAULT_FALLBACK_LEAD_MIN } from "../../api/scheduled-shared";
import {
  AppText,
  BottomSheet,
  ErrorView,
  LoadingView,
  MapFab,
  MapScreen,
  DestructiveTextButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useOptionalActiveRide } from "../../ride/ride-context";
import {
  formatClock,
  formatMoney,
  serviceName,
} from "../../ride/ride-format";
import { formatScheduleDay } from "../../ride/schedule-format";
import { colors, spacing } from "../../theme/tokens";
import { RideMap, RouteColumn } from "../ride/ride-parts";
import { ScheduledCancelSheet } from "./scheduled-cancel-sheet";
import { ClaimChip, DriverCard } from "./scheduled-parts";

export default function ScheduledRideScreen({ rideId }: { rideId: string }) {
  const { t, locale } = useLocale();
  const { row, backChevron } = useDirection();
  const { top } = useSafeAreaInsets();
  const router = useRouter();
  const facade = useOptionalActiveRide();
  const [ride, setRide] = useState<Ride | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const read = await getRide(rideId);
      if (read.state !== "scheduled") {
        router.replace(`/ride/${encodeURIComponent(read.id)}` as never);
        return;
      }
      setRide(read);
    } catch (error) {
      setFailure(failureKind(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router is stable
  }, [rideId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  // A claim / release / conversion of THIS ride re-reads it.
  const subscribe = facade?.subscribeRideEvents;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event) => {
      if (
        (event.type === "ride.state" || event.type === "ride.updated") &&
        event.ride.id === rideId
      ) {
        void load();
      }
    });
  }, [subscribe, rideId, load]);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/scheduled" as never);
  };

  if (!ride || !ride.scheduled) {
    return failure ? (
      <ErrorView kind={failure} onRetry={() => void load()} testID="scheduled-ride-error" />
    ) : (
      <LoadingView testID="scheduled-ride-loading" />
    );
  }

  const info = ride.scheduled;
  const driver = info.claimState === "claimed" ? (info.claimedBy ?? null) : null;
  const startsAt = new Date(
    new Date(info.scheduledAt).getTime() - DEFAULT_FALLBACK_LEAD_MIN * 60 * 1000,
  );
  const components = ride.estimate.components;

  return (
    <MapScreen
      testID="scheduled-ride-screen"
      map={
        <RideMap
          pickup={ride.pickup}
          stops={ride.stops}
          destination={ride.destination}
          noticeTop={top + 72}
        />
      }
      floating={
        <MapFab
          icon={backChevron}
          accessibilityLabel={t("common.back")}
          onPress={back}
          testID="scheduled-ride-back"
        />
      }
      sheet={
        <BottomSheet testID="scheduled-ride-sheet">
          <View style={styles.head}>
            <View style={row === "row" ? styles.start : styles.end}>
              <ClaimChip claimState={info.claimState} testID="scheduled-ride-status" />
            </View>
            <AppText variant="title" testID="scheduled-ride-when">
              {formatScheduleDay(info.scheduledAt, locale, t)}
            </AppText>
          </View>
          {driver ? <DriverCard driver={driver} testID="scheduled-ride-driver" /> : null}
          {!driver ? (
            <AppText variant="caption" weight={400} tone="muted">
              {t("scheduled.openNote", { minutes: DEFAULT_FALLBACK_LEAD_MIN })}
            </AppText>
          ) : null}
          <RouteColumn
            pickup={ride.pickup}
            stops={ride.stops}
            destination={ride.destination}
          />
          <View style={styles.facts}>
            <View style={[styles.fact, { flexDirection: row }]}>
              <AppText variant="secondary" tone="secondary" style={styles.flex}>
                {t("scheduled.serviceLine", {
                  service: serviceName(
                    { nameEn: ride.serviceTypeNameEn, nameAr: ride.serviceTypeNameAr },
                    locale,
                  ),
                  payment: t(`m12.payment.${ride.paymentMethod}`),
                })}
              </AppText>
              <AppText variant="secondary" weight={800} testID="scheduled-ride-estimate">
                {t("scheduled.estimateAtRideTime", {
                  money: t("m12.approx", {
                    money: formatMoney(components.total, components.currency, locale, t),
                  }),
                })}
              </AppText>
            </View>
            <View style={[styles.fact, { flexDirection: row }]}>
              <Ionicons name="notifications-outline" size={16} color={colors.textSecondary} />
              <AppText variant="caption" weight={400} tone="secondary" style={styles.flex}>
                {t("scheduled.remind")}
              </AppText>
            </View>
            <View style={[styles.fact, { flexDirection: row }]}>
              <Ionicons name="checkmark" size={16} color={colors.textSecondary} />
              <AppText
                variant="caption"
                weight={400}
                tone="secondary"
                style={styles.flex}
                testID="scheduled-ride-free-until"
              >
                {t("scheduled.freeUntil", { time: formatClock(startsAt, locale) })}
              </AppText>
            </View>
          </View>
          <DestructiveTextButton
            label={t("scheduled.cancelCta")}
            onPress={() => setCancelOpen(true)}
            testID="scheduled-ride-cancel"
          />
          {cancelOpen ? (
            <ScheduledCancelSheet
              ride={ride}
              visible={cancelOpen}
              onClose={() => setCancelOpen(false)}
              onCancelled={() => {
                setCancelOpen(false);
                back();
              }}
            />
          ) : null}
        </BottomSheet>
      }
    />
  );
}

const styles = StyleSheet.create({
  head: {
    gap: spacing.xs,
  },
  start: {
    alignItems: "flex-start",
  },
  end: {
    alignItems: "flex-end",
  },
  facts: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  fact: {
    alignItems: "center",
    gap: 10,
    minHeight: 40,
  },
  flex: {
    flex: 1,
  },
});
