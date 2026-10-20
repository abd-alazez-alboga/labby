/**
 * Building blocks shared by the ride screens (approved artboards
 * RiderFinding … RiderReceipt): the route column (pickup → stops →
 * drop-off), the driver card (no rating until M11), the stored fare
 * breakdown, the "service · Cash / amount est." footer and the ride map.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import { resolveFileUrl } from "../../api/http-client";
import type {
  DriverSummary,
  FareComponents,
  Place,
  Ride,
} from "../../api/rides";
import { AppText, useDirection } from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import type { GeoJsonLineString, LatLng } from "../../map/geo";
import { LabbyMap } from "../../map/labby-map";
import type { MapMarker } from "../../map/map-bridge";
import type { PaymentRow } from "../../ride/money-math";
import {
  fareLines,
  formatMoney,
  formatRating,
  placeLabel,
  serviceName,
} from "../../ride/ride-format";
import { colors, fontFamilies, radius, spacing } from "../../theme/tokens";

/** Re-renders every `intervalMs` with the current time (countdowns); null pauses. */
export function useNow(intervalMs: number | null = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

type Stop = { kind: "pickup" | "stop" | "dropoff"; place: Place; index: number };

/** Pickup, stops and drop-off joined by the dotted line of the artboards. */
export function RouteColumn({
  pickup,
  stops,
  destination,
  showPickup = true,
  trailing,
  testID = "route-column",
}: {
  pickup: Place;
  stops: Place[];
  destination: Place;
  showPickup?: boolean;
  /** Per-point trailing text (receipt timestamps). */
  trailing?: Partial<Record<Stop["kind"], string>>;
  testID?: string;
}) {
  const { t } = useLocale();
  const { row } = useDirection();
  const points: Stop[] = [
    ...(showPickup ? [{ kind: "pickup" as const, place: pickup, index: 0 }] : []),
    ...stops.map((place, index) => ({ kind: "stop" as const, place, index })),
    { kind: "dropoff" as const, place: destination, index: 0 },
  ];
  return (
    <View style={[styles.routeRow, { flexDirection: row }]} testID={testID}>
      <View style={styles.rail}>
        {points.map((point, i) => (
          <React.Fragment key={`${point.kind}-${point.index}`}>
            {i > 0 ? <View style={styles.railLine} /> : null}
            <View
              style={
                point.kind === "pickup"
                  ? styles.dotPickup
                  : point.kind === "stop"
                    ? styles.dotStop
                    : styles.dotDropoff
              }
            />
          </React.Fragment>
        ))}
      </View>
      <View style={styles.routeText}>
        {points.map((point) => (
          <View
            key={`${point.kind}-${point.index}`}
            style={[styles.routePoint, { flexDirection: row }]}
          >
            <View style={styles.routePointText}>
              <AppText variant="caption" tone="muted">
                {point.kind === "pickup"
                  ? t("ride.pickup")
                  : point.kind === "stop"
                    ? t("ride.stop", { number: point.index + 1 })
                    : t("ride.dropoff")}
              </AppText>
              <AppText
                variant="bodyStrong"
                weight={800}
                testID={`${testID}-${point.kind}${point.kind === "stop" ? `-${point.index}` : ""}`}
              >
                {placeLabel(point.place)}
              </AppText>
            </View>
            {trailing?.[point.kind] ? (
              <AppText variant="caption" tone="muted" weight={400}>
                {trailing[point.kind]}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

/**
 * The driver's photo (or initials on the accent tint). With `rating`
 * (DriverSummary.rating — the daily snapshot, null below 5 ratings, M11)
 * a "4.9 ★" badge sits under it (approved artboard RiderDriverOnWay);
 * a null rating shows nothing.
 */
export function DriverAvatar({
  firstName,
  photoUrl,
  size,
  rating,
}: {
  firstName: string;
  photoUrl?: string | null;
  size: number;
  rating?: number | null;
}) {
  const { t, locale } = useLocale();
  const large = size >= 56;
  // The photo URL that failed to load; that URL falls back to initials.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!photoUrl && failedUrl !== photoUrl;
  return (
    <View style={{ width: size, height: size }}>
      {showPhoto ? (
        <Image
          source={{ uri: photoUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailedUrl(photoUrl)}
          testID="driver-photo"
        />
      ) : (
        <View
          style={[
            styles.avatar,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <AppText
            variant={large ? "heading" : "bodyStrong"}
            tone="accent"
            align="center"
            style={size >= 80 ? styles.avatarLarge : undefined}
          >
            {initials(firstName)}
          </AppText>
        </View>
      )}
      {rating != null ? (
        <View
          style={styles.ratingBadge}
          accessibilityLabel={t("driverRating.label", {
            rating: formatRating(rating, locale),
          })}
          testID="driver-rating"
        >
          <AppText variant="caption" weight={800} style={styles.ratingText}>
            {`${formatRating(rating, locale)} ★`}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The vehicle's first photo (DRV-03, UC-R-05 — approved artboard
 * V1FRiderDriverCardPhoto). The URL is a signed, expiring file URL
 * (API-relative or absolute): it is resolved against the API base URL, and
 * a photo that fails to load (expired) asks for a fresh ride once —
 * `onExpired` — then shows a car icon until a new URL arrives.
 */
export function VehiclePhoto({
  photoUrl,
  label,
  onExpired,
}: {
  photoUrl?: string | null;
  /** "Photo of the driver's car: Silver Hyundai Accent". */
  label: string;
  onExpired?: () => void;
}) {
  // The photo URL that failed to load; that URL shows the car icon.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // One refetch per failure streak: a fresh URL that fails too stays on the
  // icon instead of looping; a photo that loads resets it.
  const refetched = useRef(false);
  const showPhoto = !!photoUrl && failedUrl !== photoUrl;
  return (
    <View
      style={styles.vehiclePhoto}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID="vehicle-photo-frame"
    >
      {showPhoto ? (
        <Image
          source={{ uri: resolveFileUrl(photoUrl) }}
          style={styles.vehicleImage}
          resizeMode="cover"
          onLoad={() => {
            refetched.current = false;
          }}
          onError={() => {
            setFailedUrl(photoUrl);
            if (onExpired && !refetched.current) {
              refetched.current = true;
              onExpired();
            }
          }}
          testID="vehicle-photo"
        />
      ) : (
        <View style={styles.vehicleFallback} testID="vehicle-photo-fallback">
          <Ionicons name="car-outline" size={34} color={colors.textMuted} />
        </View>
      )}
    </View>
  );
}

/**
 * Driver photo or initials (+ rating badge), first name and plate; under
 * them "Look for · {colour} {make} {model}" beside the vehicle photo
 * (approved artboard V1FRiderDriverCardPhoto). `compact` (the ended-ride
 * sheet) keeps the one-row card: vehicle under the name, no plate/photo.
 */
export function DriverCard({
  driver,
  compact = false,
  subtitleSuffix,
  onPhotoExpired,
}: {
  driver: DriverSummary;
  compact?: boolean;
  subtitleSuffix?: string;
  /** The vehicle photo's signed URL failed (expired): refetch the ride. */
  onPhotoExpired?: () => void;
}) {
  const { t } = useLocale();
  const { row } = useDirection();
  const vehicle = t("ride.vehicle", {
    color: driver.vehicle.color,
    make: driver.vehicle.make,
    model: driver.vehicle.model,
  });
  if (compact) {
    return (
      <View
        style={[styles.driverRow, { flexDirection: row }]}
        testID="driver-card"
      >
        <DriverAvatar
          firstName={driver.firstName}
          photoUrl={driver.photoUrl}
          size={44}
          rating={null}
        />
        <View style={styles.driverText}>
          <AppText variant="rowTitle" weight={800} testID="driver-name">
            {driver.firstName}
          </AppText>
          <AppText variant="secondary" tone="secondary" testID="driver-vehicle">
            {subtitleSuffix ? `${vehicle} · ${subtitleSuffix}` : vehicle}
          </AppText>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.driverCard} testID="driver-card">
      <View style={[styles.driverRow, { flexDirection: row }]}>
        <DriverAvatar
          firstName={driver.firstName}
          photoUrl={driver.photoUrl}
          size={56}
          rating={driver.rating}
        />
        <AppText
          variant="rowTitle"
          weight={800}
          style={styles.driverText}
          testID="driver-name"
        >
          {driver.firstName}
        </AppText>
        <View
          style={styles.plate}
          accessibilityLabel={t("ride.plate", { plate: driver.vehicle.plate })}
        >
          {/* Plates render in Plex Arabic, right-to-left (design system). */}
          <AppText
            variant="rowTitle"
            weight={600}
            style={styles.plateText}
            testID="driver-plate"
          >
            {driver.vehicle.plate}
          </AppText>
        </View>
      </View>
      <View
        style={[styles.vehicleBlock, { flexDirection: row }]}
        testID="driver-vehicle-block"
      >
        <VehiclePhoto
          photoUrl={driver.vehicle.photoUrl}
          label={t("ride.vehiclePhotoLabel", { vehicle })}
          onExpired={onPhotoExpired}
        />
        <View style={styles.vehicleText}>
          <AppText variant="caption" weight={700} tone="muted">
            {t("ride.lookFor")}
          </AppText>
          <AppText variant="rowTitle" weight={800} testID="driver-vehicle">
            {vehicle}
          </AppText>
        </View>
      </View>
    </View>
  );
}

/**
 * The payment line of a ride ("Economy · Cash" / "Economy · Wallet",
 * metered variants in-ride).
 */
export function ridePaymentLine(
  ride: Pick<Ride, "paymentMethod" | "serviceTypeNameEn" | "serviceTypeNameAr">,
  locale: "en" | "ar",
  t: (key: string, options?: object) => string,
  metered = false,
): string {
  const service = serviceName(
    { nameEn: ride.serviceTypeNameEn, nameAr: ride.serviceTypeNameAr },
    locale,
  );
  const wallet = ride.paymentMethod === "wallet";
  if (metered) {
    return wallet
      ? t("ride.meteredLineWallet", { service })
      : t("ride.meteredLine", { service });
  }
  return wallet
    ? t("ride.serviceWallet", { service })
    : t("ride.serviceCash", { service });
}

/** The label of a "How you paid" row (ride-complete screen and receipt). */
export function paymentRowLabel(
  line: PaymentRow,
  t: (key: string, options?: object) => string,
): string {
  switch (line.kind) {
    case "wallet":
      return t("ride.walletLine");
    case "cash":
      return t("ride.cashRestLine");
    case "due":
      return line.method === "wallet"
        ? t("ride.carriedFeeWalletLine")
        : t("ride.carriedFeeCashLine");
    case "handed":
      return t("ride.cashHandedLine");
  }
}

/** "Economy · Cash" over "SYP 22,000 est." (approximate when flagged). */
export function EstimateFooter({
  ride,
  trailing,
  metered = false,
}: {
  ride: Ride;
  trailing?: React.ReactNode;
  metered?: boolean;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const money = formatMoney(
    ride.estimate.components.total,
    ride.estimate.components.currency,
    locale,
    t,
  );
  return (
    <View style={[styles.footer, { flexDirection: row }]}>
      <View style={styles.footerText}>
        <AppText variant="caption" tone="muted" weight={400}>
          {ridePaymentLine(ride, locale, t, metered)}
        </AppText>
        <AppText variant="bodyStrong" weight={800} testID="ride-estimate">
          {ride.estimate.approximate
            ? t("ride.approximateAmount", { money })
            : t("ride.estimateAmount", { money })}
        </AppText>
      </View>
      {trailing}
    </View>
  );
}

/** The stored components, line by line, and the stored total (PRC-04). */
export function FareBreakdown({
  components,
  measured,
  totalLabel,
  testID = "fare-breakdown",
}: {
  components: FareComponents;
  measured: { distanceMeters: number; durationSeconds: number };
  /** Overrides "Total" (a shared ride's receipt says "Whole ride"). */
  totalLabel?: string;
  testID?: string;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const lines = fareLines(components, measured, locale, t);
  return (
    <View testID={testID}>
      {lines.map((line) => (
        <View
          key={line.key}
          style={[styles.fareLine, { flexDirection: row }]}
          testID={`${testID}-${line.key}`}
        >
          <AppText variant="body" tone="secondary" style={styles.fareLabel}>
            {line.label}
          </AppText>
          <AppText variant="body" weight={700}>
            {formatMoney(line.amount, components.currency, locale, t)}
          </AppText>
        </View>
      ))}
      <View
        style={[styles.fareLine, styles.fareTotal, { flexDirection: row }]}
        testID={`${testID}-total`}
      >
        <AppText variant="rowTitle" weight={800} style={styles.fareLabel}>
          {totalLabel ?? t("fare.total")}
        </AppText>
        <AppText variant="rowTitle" weight={800}>
          {formatMoney(components.total, components.currency, locale, t)}
        </AppText>
      </View>
    </View>
  );
}

/** Pickup / stops / drop-off markers, the driver when known, optional route. */
export function RideMap({
  pickup,
  stops,
  destination,
  driver,
  route,
  routeApproximate = false,
  noticeTop,
  testID = "ride-map",
}: {
  pickup: LatLng;
  stops: LatLng[];
  destination: LatLng;
  driver?: LatLng | null;
  route?: GeoJsonLineString | null;
  /** Straight-line estimate (NFR-A3): the line is drawn dashed. */
  routeApproximate?: boolean;
  noticeTop?: number;
  testID?: string;
}) {
  const markers = useMemo<MapMarker[]>(
    () => [
      { id: "pickup", kind: "origin", position: pickup },
      ...stops.map((position, index) => ({
        id: `stop-${index}`,
        kind: "stop" as const,
        position,
      })),
      { id: "destination", kind: "destination", position: destination },
      ...(driver
        ? [{ id: "driver", kind: "driver" as const, position: driver }]
        : []),
    ],
    [pickup, stops, destination, driver],
  );
  return (
    <LabbyMap
      center={driver ?? pickup}
      markers={markers}
      route={route ?? null}
      routeApproximate={routeApproximate}
      followMe={!!driver}
      noticeTop={noticeTop}
      style={styles.fill}
      testID={testID}
    />
  );
}

/** Round icon well used by the ended-ride sheets. */
export function IconWell({
  name,
  accent = false,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  accent?: boolean;
}) {
  const { flipRows } = useDirection();
  return (
    <View
      style={[
        styles.iconWell,
        accent && styles.iconWellAccent,
        flipRows ? styles.selfEnd : styles.selfStart,
      ]}
    >
      <Ionicons
        name={name}
        size={26}
        color={accent ? colors.onAccent : colors.text}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  routeRow: {
    gap: spacing.md,
  },
  rail: {
    alignItems: "center",
    paddingVertical: 22,
  },
  railLine: {
    width: 2,
    flexGrow: 1,
    minHeight: 18,
    backgroundColor: colors.grabHandle,
    marginVertical: 4,
  },
  dotPickup: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.text,
  },
  dotStop: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.textSecondary,
  },
  dotDropoff: {
    width: 10,
    height: 10,
    backgroundColor: colors.accent,
  },
  routeText: {
    flex: 1,
    gap: 14,
  },
  routePoint: {
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  routePointText: {
    flex: 1,
    gap: 2,
  },
  driverRow: {
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLarge: {
    fontSize: 28,
  },
  ratingBadge: {
    position: "absolute",
    bottom: -6,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    shadowColor: colors.text,
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  ratingText: {
    fontSize: 12,
  },
  driverText: {
    flex: 1,
    gap: 3,
  },
  driverCard: {
    gap: 14,
  },
  vehicleBlock: {
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surfacePage,
    borderRadius: radius.lg,
    padding: 10,
  },
  vehiclePhoto: {
    width: 128,
    height: 80,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.surfaceFill,
  },
  vehicleImage: {
    width: "100%",
    height: "100%",
  },
  vehicleFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleText: {
    flex: 1,
    gap: 3,
  },
  plate: {
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.text,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  plateText: {
    fontFamily: fontFamilies.arabic[600],
    writingDirection: "rtl",
  },
  footer: {
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  footerText: {
    flex: 1,
    gap: 2,
  },
  fareLine: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  fareLabel: {
    flex: 1,
  },
  fareTotal: {
    minHeight: 48,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: spacing.xs,
  },
  iconWell: {
    width: 56,
    height: 56,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWellAccent: {
    backgroundColor: colors.accent,
  },
  selfStart: {
    alignSelf: "flex-start",
  },
  selfEnd: {
    alignSelf: "flex-end",
  },
});
