/**
 * Booking (UC-R-04, RIDE-01) — approved artboards RiderWhereTo(+Ar) and
 * RiderChooseRide:
 * 1. plan: pickup / ≤3 stops / destination (RoutePlanner) with the
 *    matching-toggle line ("Nearby drivers only · Change") and the comfort
 *    preferences under it;
 * 2. choose: the region's service types with their ESTIMATES (labelled as
 *    estimates, flagged approximate when the route is a straight-line
 *    fallback), surge / pickup-fee notes, payment = Cash (M7), and the
 *    one primary action "Choose <type>" that books.
 * After a successful booking the screen closes and the home map shows the
 * dispatch state from the ride facade. Errors are explained by their
 * contract code.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  estimateRide,
  type EstimateResponse,
  listSavedLocations,
  type PaymentMethod,
  type Place,
  type RiderPreferences,
} from "../../api/rides";
import { getWallet } from "../../api/wallet";
import {
  AppText,
  Banner,
  BottomSheet,
  MapFab,
  MapScreen,
  PrimaryButton,
  TextButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useActiveRide } from "../../ride/ride-context";
import { useRiderPreferences } from "../../ride/use-rider-preferences";
import { rideErrorMessage } from "../../ride/ride-errors";
import {
  formatKm,
  formatMinutes,
  formatMoney,
  serviceName,
} from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { RideMap } from "./ride-parts";
import { type PlannedRoute, RoutePlanner } from "./route-planner";

/** "Cool · Quiet · No pref." — the comfort preferences shown in booking. */
export function comfortSummary(
  preferences: RiderPreferences,
  t: (key: string) => string,
): string {
  return [
    preferences.temperature,
    preferences.conversation,
    preferences.music,
  ]
    .map((value) => t(`ridePrefs.values.${value}`))
    .join(" · ");
}

function MatchingLine({
  preferences,
  onChange,
}: {
  preferences: RiderPreferences | null;
  onChange: () => void;
}) {
  const { t } = useLocale();
  const { row } = useDirection();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onChange}
      style={({ pressed }) => [
        styles.matching,
        { flexDirection: row },
        pressed && styles.pressed,
      ]}
      testID="booking-matching"
    >
      <Ionicons name="radio-button-on-outline" size={18} color={colors.text} />
      <View style={styles.matchingText}>
        <AppText variant="label" weight={700} testID="booking-matching-mode">
          {preferences?.pickupDistanceMode === "accept_distant_fee"
            ? t("booking.matchingDistant")
            : t("booking.matchingNearby")}
        </AppText>
        {preferences ? (
          <AppText
            variant="caption"
            tone="muted"
            weight={400}
            testID="booking-comfort"
          >
            {comfortSummary(preferences, t)}
          </AppText>
        ) : null}
      </View>
      <AppText variant="label" weight={700} tone="accent">
        {t("booking.change")}
      </AppText>
    </Pressable>
  );
}

/**
 * Wallet shortfall preview (PAY-02, approved artboard RiderWalletShort):
 * "wallet covers X / remaining in cash ~Y" with a coverage bar; one line
 * when the wallet covers the whole estimate; a note when the balance
 * couldn't be read (the backend still applies the real balance).
 */
function WalletPreview({
  total,
  currency,
  balance,
  failed,
}: {
  total: number;
  currency: string;
  balance: number | null;
  failed: boolean;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  if (failed) {
    return (
      <View style={styles.walletBox} testID="booking-wallet-preview">
        <AppText variant="caption" tone="muted" weight={400}>
          {t("booking.walletBalanceFailed")}
        </AppText>
      </View>
    );
  }
  if (balance === null) return null;
  const covers = Math.min(balance, total);
  const remaining = Math.max(0, total - covers);
  if (remaining <= 0) {
    return (
      <View style={styles.walletBox} testID="booking-wallet-preview">
        <AppText variant="caption" tone="secondary" weight={400}>
          {t("booking.walletCoversAll")}
        </AppText>
      </View>
    );
  }
  return (
    <View style={styles.walletBox} testID="booking-wallet-preview">
      <View style={[styles.walletLine, { flexDirection: row }]}>
        <AppText variant="secondary" tone="secondary" style={styles.flex}>
          {t("booking.walletCovers")}
        </AppText>
        <AppText variant="secondary" weight={700} testID="booking-wallet-covers">
          {formatMoney(covers, currency, locale, t)}
        </AppText>
      </View>
      <View style={[styles.walletLine, { flexDirection: row }]}>
        <AppText variant="secondary" tone="secondary" style={styles.flex}>
          {t("booking.remainingCash")}
        </AppText>
        <AppText variant="secondary" weight={700} testID="booking-wallet-remaining">
          {t("booking.approxMoney", {
            money: formatMoney(remaining, currency, locale, t),
          })}
        </AppText>
      </View>
      <View style={styles.bar}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.round((covers / total) * 100)}%` },
          ]}
        />
      </View>
      <AppText variant="caption" tone="muted" weight={400}>
        {t("booking.walletShortNote")}
      </AppText>
    </View>
  );
}

export default function BookingScreen({
  edit = false,
  destinationId = null,
}: {
  /** "Edit trip" from no_driver_found: start from that ride's inputs. */
  edit?: boolean;
  /** A saved place tapped on home: preset as the destination. */
  destinationId?: string | null;
}) {
  const { t, locale } = useLocale();
  const { row, backChevron } = useDirection();
  const { top } = useSafeAreaInsets();
  const router = useRouter();
  const rides = useActiveRide();
  const { preferences } = useRiderPreferences();
  const [planned, setPlanned] = useState<PlannedRoute | null>(null);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [presetDestination, setPresetDestination] = useState<Place | null>(
    null,
  );
  const [presetReady, setPresetReady] = useState(!destinationId);
  // M8 payment choice (PAY-02): cash (default) or wallet with a shortfall
  // preview from GET /wallet — approved artboard RiderWalletShort.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletFailed, setWalletFailed] = useState(false);

  // The balance is read once, when the rider first switches to wallet.
  useEffect(() => {
    if (paymentMethod !== "wallet" || walletBalance !== null || walletFailed) {
      return;
    }
    let cancelled = false;
    getWallet()
      .then((wallet) => {
        if (cancelled) return;
        const currency = estimate?.currency;
        const entry = wallet.balances.find(
          (item) => item.currency === currency,
        );
        setWalletBalance(entry?.balance ?? 0);
      })
      .catch(() => {
        if (!cancelled) setWalletFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [paymentMethod, walletBalance, walletFailed, estimate?.currency]);

  // A saved place tapped on home becomes the destination.
  useEffect(() => {
    if (!destinationId) return;
    let cancelled = false;
    listSavedLocations()
      .then((places) => {
        const place = places.find((item) => item.id === destinationId);
        if (!cancelled && place) {
          setPresetDestination({
            lat: place.lat,
            lng: place.lng,
            label: place.name,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPresetReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [destinationId]);

  const editRide = edit ? rides.ride : null;

  const requestEstimate = async (route: PlannedRoute) => {
    const result = await estimateRide(route);
    setPlanned(route);
    setEstimate(result);
    setSelected(result.options[0]?.serviceTypeId ?? null);
    setBookError(null);
  };

  const option = useMemo(
    () =>
      estimate?.options.find((item) => item.serviceTypeId === selected) ?? null,
    [estimate, selected],
  );

  const book = async () => {
    if (!planned || !option) return;
    setBooking(true);
    setBookError(null);
    try {
      await rides.book({
        pickup: planned.pickup,
        destination: planned.destination,
        stops: planned.stops,
        serviceTypeId: option.serviceTypeId,
        paymentMethod,
      });
      router.back();
    } catch (error) {
      setBookError(rideErrorMessage(error, t));
    } finally {
      setBooking(false);
    }
  };

  // Wait for the preset destination / the ride being edited.
  if (!presetReady || (edit && rides.loading)) return null;

  if (!estimate || !planned) {
    return (
      <RoutePlanner
        mode="book"
        testID="booking"
        initialPickup={planned?.pickup ?? editRide?.pickup ?? null}
        initialStops={planned?.stops ?? editRide?.stops ?? []}
        initialDestination={
          planned?.destination ?? editRide?.destination ?? presetDestination
        }
        submitLabel={t("booking.seePrices")}
        onSubmit={requestEstimate}
        onBack={() => router.back()}
        footer={
          <MatchingLine
            preferences={preferences}
            onChange={() => router.push("/ride-preferences")}
          />
        }
      />
    );
  }

  const approximate =
    estimate.route.approximate ||
    estimate.options.some((item) => item.estimate.approximate);

  return (
    <MapScreen
      testID="booking-choose"
      map={
        <RideMap
          pickup={planned.pickup}
          stops={planned.stops}
          destination={planned.destination}
          route={estimate.route.geometry}
          noticeTop={top + 72}
          testID="booking-choose-map"
        />
      }
      floating={
        <MapFab
          icon={backChevron}
          accessibilityLabel={t("common.back")}
          onPress={() => setEstimate(null)}
          testID="booking-choose-back"
        />
      }
      sheet={
        <BottomSheet style={styles.sheet}>
          <AppText variant="heading" align="center">
            {t("booking.chooseTitle")}
          </AppText>
          <ScrollView contentContainerStyle={styles.options}>
            {estimate.options.length === 0 ? (
              <AppText variant="secondary" tone="muted" testID="booking-no-options">
                {t("booking.noOptions")}
              </AppText>
            ) : null}
            {estimate.options.map((item) => {
              const isSelected = item.serviceTypeId === selected;
              const components = item.estimate.components;
              return (
                <Pressable
                  key={item.serviceTypeId}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setSelected(item.serviceTypeId)}
                  style={[
                    styles.option,
                    { flexDirection: row },
                    isSelected && styles.optionSelected,
                  ]}
                  testID={`booking-option-${item.serviceTypeId}`}
                >
                  <View style={styles.carWell}>
                    <Ionicons name="car-outline" size={26} color={colors.text} />
                  </View>
                  <View style={styles.optionText}>
                    <AppText variant="rowTitle" weight={800}>
                      {serviceName(item, locale)}
                    </AppText>
                    <AppText variant="caption" tone="secondary" weight={400}>
                      {t("booking.optionMeta", {
                        km: formatKm(item.estimate.distanceMeters, locale),
                        minutes: formatMinutes(
                          item.estimate.durationSeconds,
                          locale,
                        ),
                      })}
                    </AppText>
                  </View>
                  <AppText
                    variant="bodyStrong"
                    weight={800}
                    testID={`booking-price-${item.serviceTypeId}`}
                  >
                    {t("booking.estimateSuffix", {
                      money: formatMoney(
                        components.total,
                        components.currency,
                        locale,
                        t,
                      ),
                    })}
                  </AppText>
                </Pressable>
              );
            })}
            <AppText variant="caption" tone="muted" weight={400}>
              {t("booking.estimateNote")}
            </AppText>
            {approximate ? (
              <Banner
                tone="warning"
                message={t("booking.approximate")}
                testID="booking-approximate"
              />
            ) : null}
            {estimate.surgeMultiplier > 1 ? (
              <Banner
                tone="warning"
                message={t("booking.surge", {
                  multiplier: estimate.surgeMultiplier,
                })}
                testID="booking-surge"
              />
            ) : null}
            {estimate.pickupDistanceMode === "accept_distant_fee" &&
            estimate.pickupFeeRule ? (
              // PRC-03 disclosure card (approved artboard RiderWalletShort):
              // only riders on accept_distant_fee can be charged the fee.
              <View
                style={[styles.disclosure, { flexDirection: row }]}
                testID="booking-pickup-fee-disclosure"
              >
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={colors.textSecondary}
                />
                <AppText
                  variant="caption"
                  tone="secondary"
                  weight={400}
                  style={styles.flex}
                >
                  {t("booking.distantFeeDisclosure", {
                    km: estimate.pickupFeeRule.thresholdKm,
                    perKm: formatMoney(
                      estimate.pickupFeeRule.perKm,
                      estimate.currency,
                      locale,
                      t,
                    ),
                  })}
                </AppText>
              </View>
            ) : null}
            {bookError ? (
              <Banner tone="danger" message={bookError} testID="booking-error" />
            ) : null}
          </ScrollView>
          <View style={styles.paymentBlock}>
            <View style={[styles.payment, { flexDirection: row }]}>
              <Ionicons
                name={paymentMethod === "wallet" ? "wallet-outline" : "cash-outline"}
                size={22}
                color={colors.text}
              />
              <AppText variant="bodyStrong" style={styles.flex} testID="booking-payment">
                {paymentMethod === "wallet"
                  ? t("booking.payingWallet")
                  : t("booking.cash")}
              </AppText>
              <TextButton
                label={t("booking.change")}
                onPress={() =>
                  setPaymentMethod((method) =>
                    method === "wallet" ? "cash" : "wallet",
                  )
                }
                testID="booking-payment-change"
              />
            </View>
            {paymentMethod === "wallet" && option ? (
              <WalletPreview
                total={option.estimate.components.total}
                currency={option.estimate.components.currency}
                balance={walletBalance}
                failed={walletFailed}
              />
            ) : null}
          </View>
          <PrimaryButton
            label={t("booking.choose", {
              name: option ? serviceName(option, locale) : "",
            })}
            onPress={() => void book()}
            disabled={!option}
            loading={booking}
            testID="booking-confirm"
          />
        </BottomSheet>
      }
    />
  );
}

const styles = StyleSheet.create({
  sheet: {
    maxHeight: "72%",
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    alignItems: "center",
    gap: 14,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: "transparent",
    minHeight: 68,
  },
  optionSelected: {
    borderColor: colors.text,
  },
  carWell: {
    width: 64,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  paymentBlock: {
    gap: spacing.sm,
  },
  payment: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  walletBox: {
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.lg,
    padding: 14,
    gap: spacing.sm,
  },
  walletLine: {
    alignItems: "center",
    gap: spacing.md,
  },
  bar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.grabHandle,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    backgroundColor: colors.accent,
  },
  disclosure: {
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  flex: {
    flex: 1,
  },
  matching: {
    alignItems: "center",
    gap: 10,
    minHeight: 48,
  },
  matchingText: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.6,
  },
});
