/**
 * Create a public shared ride (UC-R-12, RIDE-P1) — approved artboard
 * RiderSharedCreate: ONE meeting point and ONE destination (the route
 * planner without stops), then the departure (at a time, or "when full" —
 * cancelled after 24 h unfilled), the seats offered (2–8) and the
 * creator's own party (1…seats), ride type + payment, the whole-ride
 * estimate and "Publish shared ride" (`POST /shared-rides`). The backend
 * validates the seats against the region's vehicles (422
 * `seats_unavailable`, `details.maxSeats`), the party (`party_too_large`)
 * and the time (`departure_in_past`). A creator whose party fills every
 * seat is dispatched at once — the ride screen takes over then.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { PromoValidation } from "../../api/growth";
import {
  estimateRide,
  type EstimateResponse,
  type PaymentMethod,
  rideErrorCode,
  rideErrorNumber,
} from "../../api/rides";
import {
  createSharedRide,
  type DepartureMode,
  SHARED_MAX_SEATS,
  SHARED_MIN_SEATS,
} from "../../api/scheduled-shared";
import {
  AppText,
  Banner,
  BottomSheet,
  ChoiceChip,
  PrimaryButton,
  Screen,
  TextButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useOptionalActiveRide } from "../../ride/ride-context";
import { rideErrorMessage } from "../../ride/ride-errors";
import { formatMoney, placeLabel, serviceName } from "../../ride/ride-format";
import { formatScheduleDay } from "../../ride/schedule-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { PromoRow, promoErrorMessage } from "../growth/promo-row";
import { type PlannedRoute, RoutePlanner } from "../ride/route-planner";
import { earliestSlot, WhenPicker } from "../scheduled/when-picker";
import { Stepper } from "./shared-parts";

/** A fresh shared ride leaves at least this far ahead by default. */
const DEFAULT_DEPARTURE_LEAD_MIN = 30;

export default function SharedCreateScreen() {
  const { t, locale } = useLocale();
  const { row, backChevron } = useDirection();
  const router = useRouter();
  const facade = useOptionalActiveRide();
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [editingRoute, setEditingRoute] = useState(true);
  const [mode, setMode] = useState<DepartureMode>("at_time");
  const [departAt, setDepartAt] = useState<Date>(() =>
    earliestSlot(DEFAULT_DEPARTURE_LEAD_MIN),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [seats, setSeats] = useState(4);
  const [party, setParty] = useState(1);
  const [serviceTypeId, setServiceTypeId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [optionsOpen, setOptionsOpen] = useState(false);
  // M13 ruling 2: discounts only the creator's own seat share at the split.
  const [promo, setPromo] = useState<PromoValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // M12 review W6: the published estimate has no surge and the departure
  // time's surcharge (surge locks at dispatch) — the estimate asks for the
  // same: the departure time, or now for "when full".
  const pricedAt = mode === "at_time" ? departAt.toISOString() : null;
  const estimateFor = (next: PlannedRoute) =>
    estimateRide(
      { pickup: next.pickup, destination: next.destination },
      pricedAt ?? new Date().toISOString(),
    );

  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    estimateFor(route)
      .then((result) => {
        if (!cancelled) setEstimate(result);
      })
      .catch(() => {
        // Keep the previous estimate; the create call prices the ride anyway.
      });
    return () => {
      cancelled = true;
    };
    // Re-price only when the departure changes (the route has its own call).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricedAt]);

  const planned = async (next: PlannedRoute) => {
    const result = await estimateFor(next);
    setRoute({ ...next, stops: [] });
    setEstimate(result);
    setServiceTypeId((current) =>
      result.options.some((item) => item.serviceTypeId === current)
        ? current
        : (result.options[0]?.serviceTypeId ?? null),
    );
    setEditingRoute(false);
  };

  if (editingRoute || !route || !estimate) {
    return (
      <RoutePlanner
        mode="book"
        allowStops={false}
        title={t("shared.createTitle")}
        testID="shared-create-route"
        initialPickup={route?.pickup ?? null}
        initialDestination={route?.destination ?? null}
        submitLabel={t("shared.next")}
        onSubmit={planned}
        onBack={() => (route ? setEditingRoute(false) : router.back())}
      />
    );
  }

  const option =
    estimate.options.find((item) => item.serviceTypeId === serviceTypeId) ?? null;

  const setSeatsClamped = (next: number) => {
    setSeats(next);
    if (party > next) setParty(next);
  };

  const publish = async () => {
    if (!option) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createSharedRide({
        pickup: route.pickup,
        destination: route.destination,
        serviceTypeId: option.serviceTypeId,
        paymentMethod,
        totalSeats: seats,
        partySize: party,
        departure:
          mode === "at_time"
            ? { mode, departAt: departAt.toISOString() }
            : { mode },
        ...(promo ? { promoCode: promo.code } : {}),
      });
      if (created.state === "gathering") {
        router.replace(`/shared/${encodeURIComponent(created.rideId)}` as never);
      } else {
        // The creator's party filled every seat: dispatched at once.
        void facade?.track(created.rideId);
        router.replace(`/ride/${encodeURIComponent(created.rideId)}` as never);
      }
    } catch (failed) {
      const code = rideErrorCode(failed);
      if (code === "seats_unavailable") {
        setError(
          t("shared.errors.seats_unavailable", {
            max: rideErrorNumber(failed, "maxSeats") ?? SHARED_MIN_SEATS,
          }),
        );
      } else if (code === "party_too_large" || code === "departure_in_past") {
        setError(t(`shared.errors.${code}`));
      } else if (code === "active_ride_exists") {
        setError(t("shared.activeRideExists"));
      } else {
        setError(promoErrorMessage(failed, t) ?? rideErrorMessage(failed, t));
      }
    } finally {
      setBusy(false);
    }
  };

  const when = formatScheduleDay(departAt, locale, t);
  const service = option ? serviceName(option, locale) : "";
  const total = option?.estimate.components.total ?? null;
  const currency = option?.estimate.components.currency ?? estimate.currency;

  return (
    <Screen edges={["top", "bottom"]} style={styles.page} testID="shared-create">
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          onPress={() => setEditingRoute(true)}
          style={styles.back}
          testID="shared-create-back"
        >
          <Ionicons name={backChevron} size={22} color={colors.text} />
        </Pressable>
        <AppText variant="title">{t("shared.createTitle")}</AppText>

        <Pressable
          accessibilityRole="button"
          onPress={() => setEditingRoute(true)}
          style={styles.routeBox}
          testID="shared-create-route-summary"
        >
          <View style={styles.field}>
            <AppText variant="caption" weight={700} tone="muted">
              {t("shared.meetingPoint")}
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {placeLabel(route.pickup)}
            </AppText>
          </View>
          <View style={styles.field}>
            <AppText variant="caption" weight={700} tone="muted">
              {t("shared.destination")}
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {placeLabel(route.destination)}
            </AppText>
          </View>
        </Pressable>

        <View style={styles.group}>
          <AppText variant="label" weight={800}>
            {t("shared.departure")}
          </AppText>
          <View
            style={[styles.segmented, { flexDirection: row }]}
            accessibilityRole="radiogroup"
          >
            {(["at_time", "when_full"] as const).map((item) => {
              const selected = mode === item;
              return (
                <Pressable
                  key={item}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setMode(item)}
                  style={[styles.segment, selected && styles.segmentOn]}
                  testID={`shared-create-mode-${item}`}
                >
                  <AppText
                    variant="label"
                    weight={selected ? 800 : 700}
                    tone={selected ? "default" : "secondary"}
                  >
                    {item === "at_time" ? t("shared.atTime") : t("shared.whenFull")}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          {mode === "at_time" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setPickerOpen(true)}
              style={[styles.timeRow, { flexDirection: row }]}
              testID="shared-create-time"
            >
              <Ionicons name="time-outline" size={18} color={colors.text} />
              <AppText variant="bodyStrong" style={styles.flex}>
                {when}
              </AppText>
              <AppText variant="label" weight={700} tone="accent">
                {t("booking.change")}
              </AppText>
            </Pressable>
          ) : null}
          <AppText variant="caption" weight={400} tone="muted">
            {mode === "at_time"
              ? t("shared.departAtNote", { time: when })
              : t("shared.whenFullNote")}
          </AppText>
        </View>

        <View style={styles.steppers}>
          <Stepper
            title={t("shared.seatsTitle")}
            hint={t("shared.seatsHint")}
            value={seats}
            min={Math.max(SHARED_MIN_SEATS, party)}
            max={SHARED_MAX_SEATS}
            onChange={setSeatsClamped}
            decreaseLabel={t("shared.fewerSeats")}
            increaseLabel={t("shared.moreSeats")}
            testID="shared-create-seats"
          />
          <Stepper
            title={t("shared.partyTitle")}
            hint={t("shared.partyCreateHint")}
            value={party}
            min={1}
            max={seats}
            onChange={setParty}
            decreaseLabel={t("shared.smallerParty")}
            increaseLabel={t("shared.largerParty")}
            testID="shared-create-party"
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setOptionsOpen(true)}
            style={[styles.optionsRow, { flexDirection: row }]}
            testID="shared-create-options"
          >
            <AppText variant="bodyStrong" style={styles.flex}>
              {t("shared.optionsRow", {
                service,
                payment: t(`m12.payment.${paymentMethod}`),
              })}
            </AppText>
            <AppText variant="label" weight={800} tone="accent">
              {t("booking.change")}
            </AppText>
          </Pressable>
        </View>
        {option ? (
          // M13 ruling 2: the promo discounts the creator's own seat share.
          <PromoRow
            context={{
              regionId: estimate.regionId,
              serviceTypeId: option.serviceTypeId,
              currency: option.estimate.components.currency,
              estimateTotal: option.estimate.components.total,
            }}
            variant="shared"
            promo={promo}
            onChange={setPromo}
            testID="shared-create-promo"
          />
        ) : null}
        {error ? (
          <Banner tone="danger" message={error} testID="shared-create-error" />
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {total !== null ? (
          <AppText
            variant="caption"
            weight={400}
            tone="secondary"
            align="center"
            testID="shared-create-estimate"
          >
            {t("shared.estimateFooter", {
              money: formatMoney(total, currency, locale, t),
            })}
          </AppText>
        ) : null}
        <PrimaryButton
          label={t("shared.publish")}
          onPress={() => void publish()}
          disabled={!option}
          loading={busy}
          testID="shared-create-publish"
        />
      </View>

      <WhenPicker
        visible={pickerOpen}
        title={t("shared.departureTimeTitle")}
        initial={departAt}
        notes={[]}
        submitLabel={(chosen) =>
          t("shared.leaveAt", {
            when: formatScheduleDay(chosen, locale, t, new Date(), true),
          })
        }
        onSubmit={(chosen) => {
          setDepartAt(chosen);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
        testID="shared-create-when"
      />

      <Modal
        visible={optionsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setOptionsOpen(false)}
        testID="shared-create-options-modal"
      >
        <View style={styles.backdrop}>
          <Pressable
            style={styles.flex}
            onPress={() => setOptionsOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={t("shared.done")}
          />
          <BottomSheet testID="shared-create-options-sheet">
            <AppText variant="heading">{t("shared.optionsTitle")}</AppText>
            <View style={[styles.chips, { flexDirection: row }]}>
              {estimate.options.map((item) => (
                <ChoiceChip
                  key={item.serviceTypeId}
                  label={serviceName(item, locale)}
                  selected={item.serviceTypeId === serviceTypeId}
                  onPress={() => setServiceTypeId(item.serviceTypeId)}
                  testID={`shared-create-service-${item.serviceTypeId}`}
                />
              ))}
            </View>
            <View style={[styles.chips, { flexDirection: row }]}>
              {(["cash", "wallet"] as const).map((item) => (
                <ChoiceChip
                  key={item}
                  label={t(`m12.payment.${item}`)}
                  selected={paymentMethod === item}
                  onPress={() => setPaymentMethod(item)}
                  testID={`shared-create-payment-${item}`}
                />
              ))}
            </View>
            <TextButton
              label={t("shared.done")}
              onPress={() => setOptionsOpen(false)}
              testID="shared-create-options-done"
            />
          </BottomSheet>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  back: {
    width: 48,
    height: 48,
    marginStart: -12,
    alignItems: "center",
    justifyContent: "center",
  },
  routeBox: {
    gap: spacing.sm,
  },
  field: {
    gap: 2,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.md - 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
  },
  group: {
    gap: spacing.sm,
  },
  segmented: {
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
  },
  segment: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentOn: {
    backgroundColor: colors.surface,
  },
  timeRow: {
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md - 2,
    borderWidth: 1.5,
    borderColor: colors.grabHandle,
  },
  steppers: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  optionsRow: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  chips: {
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,16,24,0.48)",
  },
  flex: {
    flex: 1,
  },
});
