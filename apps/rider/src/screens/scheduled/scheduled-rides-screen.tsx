/**
 * Upcoming scheduled rides (UC-R-11) — approved artboards
 * RiderSchedUpcoming(+Ar): `GET /scheduled-rides`, soonest first, each with
 * its claim status ("Driver confirmed" + the claiming driver, or "Waiting
 * for a driver" with the fallback note); a card opens the ride; "Schedule a
 * ride" starts the scheduling flow. Re-read whenever the screen is focused
 * (a cancel on the detail screen comes back here), when the app returns to
 * the foreground, on pull-to-refresh, and on a realtime ride frame for a
 * listed or scheduled ride (claim / release / conversion / state change —
 * the same frames the detail screen follows).
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import type { Ride } from "../../api/rides";
import {
  DEFAULT_FALLBACK_LEAD_MIN,
  listScheduledRides,
} from "../../api/scheduled-shared";
import {
  AppText,
  EmptyView,
  ErrorView,
  LoadingView,
  PrimaryButton,
  ScreenScrollView,
  screenStyles,
  useBottomBarPadding,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useOptionalActiveRide } from "../../ride/ride-context";
import { placeLabel } from "../../ride/ride-format";
import { formatScheduleDay } from "../../ride/schedule-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { ClaimChip, DriverInitial, driverLine } from "./scheduled-parts";

function ScheduledCard({ ride, onPress }: { ride: Ride; onPress: () => void }) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const info = ride.scheduled;
  if (!info) return null;
  const driver = info.claimState === "claimed" ? (info.claimedBy ?? null) : null;
  const line = driver ? driverLine(driver, locale, t) : null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      testID={`scheduled-card-${ride.id}`}
    >
      <View style={[styles.cardHead, { flexDirection: row }]}>
        <AppText variant="rowTitle" weight={800} style={styles.flex}>
          {formatScheduleDay(info.scheduledAt, locale, t)}
        </AppText>
        <ClaimChip claimState={info.claimState} testID={`scheduled-status-${ride.id}`} />
      </View>
      <View style={styles.places}>
        <AppText variant="secondary" tone="secondary">
          {t("m12.from", { place: placeLabel(ride.pickup, t) })}
        </AppText>
        <AppText variant="secondary" weight={700}>
          {t("m12.to", { place: placeLabel(ride.destination, t) })}
        </AppText>
      </View>
      <View style={[styles.cardFoot, { flexDirection: row }]}>
        {driver && line ? (
          <>
            <DriverInitial name={driver.firstName} size={32} />
            <AppText variant="caption" weight={400} tone="secondary" style={styles.flex}>
              {`${line.name} · ${line.vehicle}`}
            </AppText>
          </>
        ) : (
          <AppText variant="caption" weight={400} tone="muted" style={styles.flex}>
            {t("scheduled.openNote", { minutes: DEFAULT_FALLBACK_LEAD_MIN })}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

export default function ScheduledRidesScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const barPadding = useBottomBarPadding(spacing.lg);
  const facade = useOptionalActiveRide();
  const listed = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchList = useCallback(async () => {
    setFailure(null);
    try {
      const list = await listScheduledRides();
      if (!mounted.current) return;
      listed.current = new Set(list.map((ride) => ride.id));
      setRides(list);
    } catch (error) {
      if (mounted.current) setFailure(failureKind(error));
    }
  }, []);

  const load = useCallback(() => {
    void fetchList();
  }, [fetchList]);

  useFocusEffect(load);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchList();
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [fetchList]);

  // Back in the foreground: the claim may have changed meanwhile.
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (previous !== "active" && next === "active") void fetchList();
      previous = next;
    });
    return () => subscription.remove();
  }, [fetchList]);

  // A claim / release / conversion / state change of a listed (or newly
  // scheduled) ride re-reads the list.
  const subscribe = facade?.subscribeRideEvents;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event) => {
      if (
        (event.type === "ride.state" || event.type === "ride.updated") &&
        (listed.current.has(event.ride.id) || event.ride.scheduled)
      ) {
        void fetchList();
      }
    });
  }, [subscribe, fetchList]);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      tintColor={colors.accent}
      colors={[colors.accent]}
    />
  );

  let body: React.ReactNode;
  if (failure && !rides) {
    body = <ErrorView kind={failure} onRetry={() => void load()} testID="scheduled-error" />;
  } else if (!rides) {
    body = <LoadingView testID="scheduled-loading" />;
  } else if (rides.length === 0) {
    body = (
      <ScreenScrollView
        contentContainerStyle={styles.grow}
        refreshControl={refreshControl}
        testID="scheduled-list"
      >
        <EmptyView
          icon="calendar-outline"
          title={t("scheduled.emptyTitle")}
          body={t("scheduled.emptyBody")}
          testID="scheduled-empty"
        />
      </ScreenScrollView>
    );
  } else {
    body = (
      <ScreenScrollView
        contentContainerStyle={screenStyles.content}
        refreshControl={refreshControl}
        testID="scheduled-list"
      >
        {rides.map((ride) => (
          <ScheduledCard
            key={ride.id}
            ride={ride}
            onPress={() =>
              router.push(`/scheduled/${encodeURIComponent(ride.id)}` as never)
            }
          />
        ))}
      </ScreenScrollView>
    );
  }

  return (
    <View style={screenStyles.page} testID="scheduled-screen">
      <View style={styles.flex}>{body}</View>
      <View style={[styles.bar, { paddingBottom: barPadding }]}>
        <PrimaryButton
          label={t("scheduled.scheduleARide")}
          onPress={() => router.push("/schedule" as never)}
          testID="scheduled-new"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  grow: {
    flexGrow: 1,
  },
  card: {
    gap: 10,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  cardHead: {
    alignItems: "center",
    gap: spacing.sm,
  },
  places: {
    gap: spacing.xs,
  },
  cardFoot: {
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
  },
  bar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
});
