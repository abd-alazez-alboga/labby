/**
 * Browse open shared rides (UC-R-13 step 1) — approved artboards
 * RiderSharedBrowse(+Ar): `GET /shared-rides` around the rider's position,
 * optionally near a destination (a saved place or a pin — the contract has
 * no geocoding) and within a departure range (Any time / Next 2 hours /
 * Today; "when full" rides always match). Cards show destination,
 * departure, pickup + distance from the rider, ride type, seat dots with
 * occupancy and the whole-ride estimate; a ride the rider is already in
 * says so. "Create a shared ride" opens creation.
 */
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import { type Place, rideErrorCode } from "../../api/rides";
import {
  listSharedRides,
  type SharedRide,
} from "../../api/scheduled-shared";
import {
  AppText,
  BottomSheet,
  ChoiceChip,
  EmptyView,
  ErrorView,
  ListRow,
  LoadingView,
  PrimaryButton,
  screenStyles,
  StatusChip,
  useBottomBarPadding,
  useDirection,
  useInsetContentStyle,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useCurrentPosition } from "../../location/use-current-position";
import { rideErrorMessage } from "../../ride/ride-errors";
import { formatMoney, placeLabel, serviceName } from "../../ride/ride-format";
import { distanceMeters, formatDistance, startOfDay } from "../../ride/schedule-format";
import { useSavedPlaces } from "../../ride/use-saved-places";
import { colors, radius, spacing } from "../../theme/tokens";
import { PinPicker } from "../ride/pin-picker";
import { savedPlaceIcon, savedToPlace } from "../ride/route-planner";
import { departureShort, SeatDots } from "./shared-parts";

type TimeFilter = "any" | "next2h" | "today";

function timeRange(filter: TimeFilter): { departFrom?: string; departTo?: string } {
  const now = new Date();
  if (filter === "next2h") {
    return {
      departFrom: now.toISOString(),
      departTo: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    };
  }
  if (filter === "today") {
    const end = startOfDay(now);
    end.setDate(end.getDate() + 1);
    return { departFrom: now.toISOString(), departTo: end.toISOString() };
  }
  return {};
}

function SharedCard({
  ride,
  here,
  onPress,
}: {
  ride: SharedRide;
  here: { lat: number; lng: number } | null;
  onPress: () => void;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const service = serviceName(
    { nameEn: ride.serviceTypeNameEn, nameAr: ride.serviceTypeNameAr },
    locale,
  );
  const from = here
    ? t("shared.cardFrom", {
        place: placeLabel(ride.pickup),
        distance: formatDistance(distanceMeters(here, ride.pickup), locale, t),
        service,
      })
    : t("shared.cardFromNoDistance", { place: placeLabel(ride.pickup), service });
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      testID={`shared-card-${ride.rideId}`}
    >
      <View style={[styles.cardHead, { flexDirection: row }]}>
        <AppText variant="rowTitle" weight={800} style={styles.flex}>
          {placeLabel(ride.destination)}
        </AppText>
        <AppText variant="label" weight={800}>
          {departureShort(ride.departure, locale, t)}
        </AppText>
      </View>
      <AppText variant="caption" weight={400} tone="secondary">
        {from}
      </AppText>
      <View style={[styles.cardFoot, { flexDirection: row }]}>
        <SeatDots taken={ride.seatsTaken} total={ride.totalSeats} />
        <AppText
          variant="caption"
          weight={700}
          style={styles.flex}
          testID={`shared-card-occupancy-${ride.rideId}`}
        >
          {t("shared.occupancy", {
            taken: ride.seatsTaken,
            total: ride.totalSeats,
            left: ride.seatsLeft,
          })}
        </AppText>
        <AppText variant="caption" weight={400} tone="secondary">
          {t("shared.rideEstimate", {
            money: formatMoney(ride.estimateTotal, ride.currency, locale, t),
          })}
        </AppText>
      </View>
      {ride.me ? (
        <StatusChip
          tone="accent"
          label={t("shared.youreIn")}
          testID={`shared-card-member-${ride.rideId}`}
          style={row === "row" ? styles.selfStart : styles.selfEnd}
        />
      ) : null}
    </Pressable>
  );
}

export default function SharedRidesScreen() {
  const { t } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const current = useCurrentPosition();
  const saved = useSavedPlaces();
  const [filter, setFilter] = useState<TimeFilter>("any");
  const [destination, setDestination] = useState<Place | null>(null);
  const [choosing, setChoosing] = useState<"list" | "pin" | null>(null);
  const [rides, setRides] = useState<SharedRide[] | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const barPadding = useBottomBarPadding(spacing.lg);
  const listStyle = useInsetContentStyle(styles.list);

  const here = current.position;
  const lat = here?.lat ?? null;
  const lng = here?.lng ?? null;

  const load = useCallback(() => {
    if (lat === null || lng === null) return;
    let cancelled = false;
    setFailure(null);
    setError(null);
    listSharedRides({
      lat,
      lng,
      destLat: destination?.lat,
      destLng: destination?.lng,
      ...timeRange(filter),
    })
      .then((page) => {
        if (!cancelled) setRides(page.items);
      })
      .catch((failed) => {
        if (cancelled) return;
        // 422 outside_region and other coded errors read as a message.
        if (rideErrorCode(failed)) {
          setError(rideErrorMessage(failed, t));
          setRides([]);
        } else {
          setFailure(failureKind(failed));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, destination, filter, t]);

  useFocusEffect(load);

  const pinStart = destination ?? here;
  if (choosing === "pin" && pinStart) {
    return (
      <PinPicker
        initial={pinStart}
        onConfirm={(point) => {
          setDestination({ ...point, label: t("booking.pinnedPlace") });
          setChoosing(null);
        }}
        onBack={() => setChoosing(null)}
        testID="shared-pin"
      />
    );
  }

  let body: React.ReactNode;
  if (failure && !rides) {
    body = <ErrorView kind={failure} onRetry={() => void load()} testID="shared-error" />;
  } else if (!rides) {
    body =
      current.status === "permissionDenied" || current.status === "unavailable" ? (
        <EmptyView
          icon="location-outline"
          title={t("region.permissionDeniedTitle")}
          body={t("region.permissionDeniedBody")}
          testID="shared-no-location"
        />
      ) : (
        <LoadingView testID="shared-loading" />
      );
  } else {
    body = (
      <ScrollView contentContainerStyle={listStyle}>
        {error ? (
          <AppText variant="secondary" tone="danger" testID="shared-message">
            {error}
          </AppText>
        ) : null}
        {rides.length === 0 && !error ? (
          <EmptyView
            icon="people-outline"
            title={t("shared.emptyTitle")}
            body={t("shared.emptyBody")}
            testID="shared-empty"
          />
        ) : null}
        {rides.map((ride) => (
          <SharedCard
            key={ride.rideId}
            ride={ride}
            here={here}
            onPress={() =>
              router.push(`/shared/${encodeURIComponent(ride.rideId)}` as never)
            }
          />
        ))}
        {rides.length > 0 ? (
          <AppText variant="caption" weight={400} tone="muted">
            {t("shared.privacyNote")}
          </AppText>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={screenStyles.page} testID="shared-screen">
      <View style={styles.filters}>
        <Pressable
          accessibilityRole="search"
          accessibilityLabel={t("shared.chooseDestination")}
          onPress={() => setChoosing("list")}
          style={[styles.search, { flexDirection: row }]}
          testID="shared-destination"
        >
          <Ionicons name="search" size={18} color={colors.text} />
          <AppText
            variant="bodyStrong"
            weight={600}
            tone={destination ? "default" : "muted"}
            style={styles.flex}
            numberOfLines={1}
          >
            {destination ? placeLabel(destination) : t("shared.searchPlaceholder")}
          </AppText>
          {destination ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("shared.clearDestination")}
              onPress={() => setDestination(null)}
              style={styles.clear}
              testID="shared-destination-clear"
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </Pressable>
        <View style={[styles.chips, { flexDirection: row }]}>
          {(["any", "next2h", "today"] as const).map((item) => (
            <ChoiceChip
              key={item}
              label={t(item === "any" ? "shared.anyTime" : `shared.${item}`)}
              selected={filter === item}
              onPress={() => setFilter(item)}
              testID={`shared-filter-${item}`}
            />
          ))}
        </View>
      </View>
      <View style={styles.flex}>{body}</View>
      <View style={[styles.bar, { paddingBottom: barPadding }]}>
        <PrimaryButton
          label={t("shared.createCta")}
          onPress={() => router.push("/shared/create" as never)}
          testID="shared-create"
        />
      </View>
      <Modal
        visible={choosing === "list"}
        transparent
        animationType="slide"
        onRequestClose={() => setChoosing(null)}
        testID="shared-destination-modal"
      >
        <View style={styles.backdrop}>
          <Pressable
            style={styles.flex}
            onPress={() => setChoosing(null)}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
          />
          <BottomSheet testID="shared-destination-sheet">
            <AppText variant="heading">{t("shared.chooseDestination")}</AppText>
            <View>
              {saved.places.map((place) => (
                <ListRow
                  key={place.id}
                  icon={savedPlaceIcon(place.name)}
                  title={place.name}
                  subtitle={place.address ?? placeLabel(place)}
                  onPress={() => {
                    setDestination(savedToPlace(place));
                    setChoosing(null);
                  }}
                  testID={`shared-destination-saved-${place.id}`}
                />
              ))}
              {pinStart ? (
                <ListRow
                  icon="location-outline"
                  title={t("booking.chooseOnMap")}
                  subtitle={t("booking.dropPin")}
                  last
                  onPress={() => setChoosing("pin")}
                  testID="shared-destination-map"
                />
              ) : null}
            </View>
          </BottomSheet>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  filters: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  search: {
    alignItems: "center",
    gap: 10,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    paddingHorizontal: spacing.lg,
  },
  clear: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: {
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  card: {
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  cardHead: {
    alignItems: "baseline",
    gap: spacing.sm,
  },
  cardFoot: {
    alignItems: "center",
    gap: 10,
  },
  selfStart: {
    alignSelf: "flex-start",
  },
  selfEnd: {
    alignSelf: "flex-end",
  },
  bar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,16,24,0.48)",
  },
  pressed: {
    opacity: 0.7,
  },
});
