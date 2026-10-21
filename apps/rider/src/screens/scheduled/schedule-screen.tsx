/**
 * Schedule a ride (UC-R-10, RIDE-S1) — approved artboards RiderSchedWhen,
 * RiderSchedChoose and RiderSchedTooSoon:
 * 1. when: the pickup-time sheet (≥ 30 min ahead, no horizon limit);
 * 2. plan: the booking route planner (pickup, ≤ 3 stops, destination);
 * 3. choose: estimates for that time WITHOUT surge, flagged "priced at ride
 *    time" (`POST /rides/estimate` with `scheduledAt`), payment, and
 *    "Schedule <type>" (`POST /scheduled-rides`).
 * Too soon (client check, or the backend's 422 `scheduled_too_soon` with
 * `details.minLeadMinutes`) never books on demand silently (ruling
 * 2026-10-16): the sheet offers "Book now instead" (booking, the route
 * kept) or another time. A scheduled ride lands in the upcoming list.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PromoValidation } from "../../api/growth";
import {
  estimateRide,
  type EstimateResponse,
  type PaymentMethod,
  rideErrorCode,
  rideErrorNumber,
} from "../../api/rides";
import {
  DEFAULT_FALLBACK_LEAD_MIN,
  DEFAULT_MIN_LEAD_MIN,
  scheduleRide,
} from "../../api/scheduled-shared";
import {
  AppText,
  Banner,
  BottomSheet,
  MapFab,
  MapScreen,
  PrimaryButton,
  SecondaryButton,
  TextButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { rideErrorMessage } from "../../ride/ride-errors";
import {
  formatKm,
  formatMinutes,
  formatMoney,
  serviceName,
} from "../../ride/ride-format";
import { formatScheduleDay } from "../../ride/schedule-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { PromoRow, promoErrorMessage } from "../growth/promo-row";
import { RideMap } from "../ride/ride-parts";
import { type PlannedRoute, RoutePlanner } from "../ride/route-planner";
import {
  BookingRefusedSheet,
  useBookingRefusal,
} from "../trust/suspension-support";
import { earliestSlot, WhenPicker } from "./when-picker";

/** `/booking?route=…` — the planned route handed to on-demand booking. */
export function bookingHrefWithRoute(route: PlannedRoute | null): string {
  return route
    ? `/booking?route=${encodeURIComponent(JSON.stringify(route))}`
    : "/booking";
}

function TooSoonSheet({
  visible,
  minutes,
  onBookNow,
  onPickAnother,
}: {
  visible: boolean;
  minutes: number;
  onBookNow: () => void;
  onPickAnother: () => void;
}) {
  const { t } = useLocale();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onPickAnother}
      testID="schedule-too-soon-modal"
    >
      <View style={styles.backdrop}>
        <View style={styles.flex} />
        <BottomSheet testID="schedule-too-soon">
          <View style={styles.iconWell}>
            <Ionicons name="time-outline" size={26} color={colors.accent} />
          </View>
          <AppText variant="title">{t("scheduled.tooSoonTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {t("scheduled.tooSoonBody", { minutes })}
          </AppText>
          <PrimaryButton
            label={t("scheduled.bookNowInstead")}
            onPress={onBookNow}
            testID="schedule-book-now"
          />
          <SecondaryButton
            label={t("scheduled.pickAnotherTime")}
            onPress={onPickAnother}
            testID="schedule-pick-another"
          />
        </BottomSheet>
      </View>
    </Modal>
  );
}

export default function ScheduleScreen() {
  const { t, locale } = useLocale();
  const { row, backChevron } = useDirection();
  const { top } = useSafeAreaInsets();
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [tooSoon, setTooSoon] = useState<number | null>(null);
  const [planned, setPlanned] = useState<PlannedRoute | null>(null);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  // M13 ruling 3: validated + reserved at booking, amount at ride time.
  const [promo, setPromo] = useState<PromoValidation | null>(null);
  // M13 review W9: a promo refused at BOOKING is dropped, explained on the row.
  const [promoRefusal, setPromoRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 403 rider_suspended: the booking-refused sheet (W39).
  const refused = useBookingRefusal();

  const minLead = DEFAULT_MIN_LEAD_MIN;
  const option =
    estimate?.options.find((item) => item.serviceTypeId === selected) ?? null;

  const requestEstimate = async (route: PlannedRoute, at: Date) => {
    const result = await estimateRide(route, at.toISOString());
    setPlanned(route);
    setEstimate(result);
    setSelected((current) =>
      result.options.some((item) => item.serviceTypeId === current)
        ? current
        : (result.options[0]?.serviceTypeId ?? null),
    );
    setError(null);
  };

  const chooseTime = (chosen: Date) => {
    if (chosen.getTime() < Date.now() + minLead * 60 * 1000) {
      setPickerOpen(false);
      setTooSoon(minLead);
      return;
    }
    setScheduledAt(chosen);
    setPickerOpen(false);
    if (planned) {
      // A new time on the choose step: the surcharge window may differ.
      requestEstimate(planned, chosen).catch((failure) =>
        setError(rideErrorMessage(failure, t)),
      );
    }
  };

  const schedule = async () => {
    if (!planned || !option || !scheduledAt) return;
    setBusy(true);
    setError(null);
    try {
      await scheduleRide({
        pickup: planned.pickup,
        destination: planned.destination,
        stops: planned.stops,
        serviceTypeId: option.serviceTypeId,
        paymentMethod,
        scheduledAt: scheduledAt.toISOString(),
        ...(promo ? { promoCode: promo.code } : {}),
      });
      router.replace("/scheduled" as never);
    } catch (failure) {
      if (rideErrorCode(failure) === "scheduled_too_soon") {
        setTooSoon(rideErrorNumber(failure, "minLeadMinutes") ?? minLead);
      } else {
        const promoMessage = promoErrorMessage(failure, t);
        if (promoMessage) {
          // Review W9: drop the refused promo so the next tap books without it.
          setPromo(null);
          setPromoRefusal(promoMessage);
        } else if (!refused.catchRefusal(failure)) {
          setError(rideErrorMessage(failure, t));
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const when = scheduledAt
    ? formatScheduleDay(scheduledAt, locale, t, new Date(), true)
    : "";

  const pickupChip = (
    <Pressable
      accessibilityRole="button"
      onPress={() => setPickerOpen(true)}
      style={({ pressed }) => [
        styles.timeChip,
        { flexDirection: row },
        pressed && styles.pressed,
      ]}
      testID="schedule-time-chip"
    >
      <Ionicons name="time-outline" size={16} color={colors.text} />
      <AppText variant="label" weight={800}>
        {t("scheduled.pickupChip", { when })}
      </AppText>
      <AppText variant="label" weight={800} tone="accent">
        {t("booking.change")}
      </AppText>
    </Pressable>
  );

  const sheets = (
    <>
      <WhenPicker
        visible={pickerOpen}
        title={t("scheduled.whenTitle")}
        initial={scheduledAt ?? earliestSlot(minLead)}
        notes={[
          {
            icon: "time-outline",
            text: t("scheduled.noteLead", { minutes: minLead }),
          },
          {
            icon: "checkmark",
            text: t("scheduled.noteFree", {
              minutes: DEFAULT_FALLBACK_LEAD_MIN,
            }),
          },
        ]}
        submitLabel={(chosen) =>
          t("scheduled.pickUpAt", {
            when: formatScheduleDay(chosen, locale, t, new Date(), true),
          })
        }
        onSubmit={chooseTime}
        secondaryLabel={scheduledAt ? undefined : t("scheduled.rideNowInstead")}
        onSecondary={() => router.replace("/booking" as never)}
        onClose={() => {
          setPickerOpen(false);
          if (!scheduledAt) router.back();
        }}
        testID="schedule-when"
      />
      <TooSoonSheet
        visible={tooSoon !== null}
        minutes={tooSoon ?? minLead}
        onBookNow={() => {
          setTooSoon(null);
          router.replace(bookingHrefWithRoute(planned) as never);
        }}
        onPickAnother={() => {
          setTooSoon(null);
          setPickerOpen(true);
        }}
      />
    </>
  );

  if (!scheduledAt) {
    return (
      <View style={styles.mapGround} testID="schedule-screen">
        {sheets}
      </View>
    );
  }

  if (!estimate || !planned) {
    return (
      <>
        <RoutePlanner
          mode="book"
          testID="schedule-plan"
          initialPickup={planned?.pickup ?? null}
          initialStops={planned?.stops ?? []}
          initialDestination={planned?.destination ?? null}
          submitLabel={t("booking.seePrices")}
          onSubmit={(route) => requestEstimate(route, scheduledAt)}
          onBack={() => router.back()}
          footer={<View style={styles.chipRow}>{pickupChip}</View>}
        />
        {sheets}
      </>
    );
  }

  return (
    <MapScreen
      testID="schedule-choose"
      map={
        <RideMap
          pickup={planned.pickup}
          stops={planned.stops}
          destination={planned.destination}
          route={estimate.route.geometry}
          noticeTop={top + 72}
          testID="schedule-choose-map"
        />
      }
      floating={
        <MapFab
          icon={backChevron}
          accessibilityLabel={t("common.back")}
          onPress={() => setEstimate(null)}
          testID="schedule-choose-back"
        />
      }
      sheet={
        <BottomSheet style={styles.sheet}>
          <AppText variant="heading" align="center">
            {t("booking.chooseTitle")}
          </AppText>
          <View style={styles.chipRow}>{pickupChip}</View>
          <ScrollView
            contentContainerStyle={styles.options}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={[styles.priced, { flexDirection: row }]}
              testID="schedule-priced-at-ride-time"
            >
              <Ionicons name="trending-up" size={20} color={colors.accent} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong" weight={800}>
                  {t("scheduled.pricedTitle")}
                </AppText>
                <AppText variant="caption" weight={400} tone="secondary">
                  {t("scheduled.pricedBody")}
                </AppText>
              </View>
            </View>
            {estimate.options.length === 0 ? (
              <AppText variant="secondary" tone="muted">
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
                  testID={`schedule-option-${item.serviceTypeId}`}
                >
                  <View style={styles.carWell}>
                    <Ionicons
                      name="car-outline"
                      size={26}
                      color={colors.text}
                    />
                  </View>
                  <View style={styles.flex}>
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
                  <View style={styles.price}>
                    <AppText
                      variant="bodyStrong"
                      weight={800}
                      testID={`schedule-price-${item.serviceTypeId}`}
                    >
                      {t("m12.approx", {
                        money: formatMoney(
                          components.total,
                          components.currency,
                          locale,
                          t,
                        ),
                      })}
                    </AppText>
                    <AppText variant="caption" weight={700} tone="accent">
                      {t("scheduled.atRideTime")}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
            {option ? (
              // M13 ruling 3: the code is reserved now, the amount worked
              // out at ride time — the chip copy says so (no preview).
              <PromoRow
                context={{
                  regionId: estimate.regionId,
                  serviceTypeId: option.serviceTypeId,
                  currency: option.estimate.components.currency,
                  scheduledAt: scheduledAt.toISOString(),
                }}
                variant="scheduled"
                promo={promo}
                onChange={(next) => {
                  setPromo(next);
                  setPromoRefusal(null);
                }}
                externalError={promoRefusal}
                testID="schedule-promo"
              />
            ) : null}
            {error ? (
              <Banner tone="danger" message={error} testID="schedule-error" />
            ) : null}
          </ScrollView>
          <View style={[styles.payment, { flexDirection: row }]}>
            <Ionicons
              name={
                paymentMethod === "wallet" ? "wallet-outline" : "cash-outline"
              }
              size={22}
              color={colors.text}
            />
            <AppText
              variant="bodyStrong"
              style={styles.flex}
              testID="schedule-payment"
            >
              {t(`m12.payment.${paymentMethod}`)}
            </AppText>
            <TextButton
              label={t("booking.change")}
              onPress={() =>
                setPaymentMethod((method) =>
                  method === "wallet" ? "cash" : "wallet",
                )
              }
              testID="schedule-payment-change"
            />
          </View>
          <PrimaryButton
            label={t("scheduled.scheduleCta", {
              name: option ? serviceName(option, locale) : "",
            })}
            onPress={() => void schedule()}
            disabled={!option}
            loading={busy}
            testID="schedule-confirm"
          />
          {sheets}
          <BookingRefusedSheet refusal={refused.refusal} onClose={refused.close} />
        </BottomSheet>
      }
    />
  );
}

const styles = StyleSheet.create({
  mapGround: {
    flex: 1,
    backgroundColor: colors.surfaceMap,
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,16,24,0.48)",
  },
  iconWell: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: {
    maxHeight: "78%",
  },
  chipRow: {
    alignItems: "center",
  },
  timeChip: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    gap: spacing.sm,
  },
  options: {
    gap: spacing.sm,
  },
  priced: {
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.accentTint,
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
  price: {
    alignItems: "flex-end",
    gap: 2,
  },
  payment: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  flex: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
