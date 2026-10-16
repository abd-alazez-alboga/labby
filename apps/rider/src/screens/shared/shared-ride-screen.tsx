/**
 * One shared ride before dispatch — approved artboards:
 * - RiderSharedJoin (UC-R-13): pickup, departure rule, occupancy, the
 *   per-seat basis, party size and payment, "Join · N seats"; E1 (409
 *   `insufficient_seats`, `details.seatsLeft`) inline and E2 (409
 *   `shared_ride_closed`) as a sheet — RiderSharedJoinErrors;
 * - RiderSharedGathering (UC-R-15, creator): occupancy, departure, "Start
 *   now with N seats" and "Cancel shared ride" (free, everyone told);
 * - RiderSharedMember (UC-R-14): occupancy, own party + payment, "Leave ·
 *   free before it leaves".
 * Members never see other members (privacy rule). `shared.occupancy` and
 * ride frames for this ride update it live; once dispatched the ride
 * screen takes over (every member tracks the driver, UC-R-05).
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { failureKind, type FailureKind } from "../../api/http-client";
import {
  type PaymentMethod,
  rideErrorCode,
  rideErrorNumber,
} from "../../api/rides";
import {
  cancelSharedRide,
  getSharedRide,
  joinSharedRide,
  leaveSharedRide,
  SHARED_CANCEL_REASONS,
  type SharedCancelReason,
  type SharedRide,
  startSharedRide,
} from "../../api/scheduled-shared";
import {
  AppText,
  Banner,
  BottomSheet,
  DestructiveTextButton,
  ErrorView,
  LoadingView,
  MapFab,
  MapScreen,
  PrimaryButton,
  SecondaryButton,
  TextButton,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useOptionalActiveRide } from "../../ride/ride-context";
import { rideErrorMessage } from "../../ride/ride-errors";
import { formatMoney, placeLabel, serviceName } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { RideMap } from "../ride/ride-parts";
import {
  departureRule,
  departureValue,
  OccupancyBar,
  perSeat,
  SeatDots,
  Stepper,
} from "./shared-parts";

const LIVE = [
  "requested",
  "offering",
  "accepted",
  "driver_arrived",
  "in_progress",
  "completed",
];

function FactRow({
  icon,
  leading,
  label,
  value,
  testID,
}: {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  leading?: React.ReactNode;
  label?: string;
  value: string;
  testID?: string;
}) {
  const { row } = useDirection();
  return (
    <View style={[styles.fact, { flexDirection: row }]} testID={testID}>
      {leading ?? (icon ? <Ionicons name={icon} size={20} color={colors.text} /> : null)}
      <View style={styles.flex}>
        {label ? (
          <AppText variant="caption" weight={700} tone="muted">
            {label}
          </AppText>
        ) : null}
        <AppText variant="secondary" weight={700}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

function ValueRow({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  const { row } = useDirection();
  return (
    <View style={[styles.valueRow, { flexDirection: row }]}>
      <AppText variant="secondary" tone="secondary" style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="secondary" weight={800} testID={testID}>
        {value}
      </AppText>
    </View>
  );
}

function CancelSharedSheet({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (reason: SharedCancelReason, note?: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const { row } = useDirection();
  const [reason, setReason] = useState<SharedCancelReason>("changed_mind");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (reason === "other" && !note.trim()) {
      setNoteError(t("cancel.noteRequired"));
      return;
    }
    setNoteError(null);
    setError(null);
    setBusy(true);
    try {
      await onConfirm(reason, reason === "other" ? note.trim() : undefined);
    } catch (failure) {
      setError(
        rideErrorCode(failure) === "illegal_state"
          ? t("cancel.notCancellable")
          : t("shared.actionFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="shared-cancel-modal"
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.flex}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("shared.keepIt")}
        />
        <BottomSheet testID="shared-cancel-sheet">
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <AppText variant="title">{t("shared.cancelTitle")}</AppText>
            <Banner tone="neutral" message={t("shared.cancelBody")} />
            <AppText variant="label" weight={700} tone="secondary">
              {t("cancel.reasonLegend")}
            </AppText>
            <View accessibilityRole="radiogroup">
              {SHARED_CANCEL_REASONS.map((item, index) => {
                const selected = item === reason;
                return (
                  <Pressable
                    key={item}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setReason(item)}
                    style={[
                      styles.reason,
                      { flexDirection: row },
                      index < SHARED_CANCEL_REASONS.length - 1 && styles.divider,
                    ]}
                    testID={`shared-cancel-reason-${item}`}
                  >
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {t(`cancel.reasons.${item}`)}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            {reason === "other" ? (
              <TextField
                label={t("cancel.noteLabel")}
                value={note}
                onChangeText={setNote}
                maxLength={500}
                error={noteError}
                testID="shared-cancel-note"
              />
            ) : null}
            {error ? (
              <Banner tone="danger" message={error} testID="shared-cancel-error" />
            ) : null}
          </ScrollView>
          <PrimaryButton
            label={t("shared.keepIt")}
            onPress={onClose}
            testID="shared-cancel-keep"
          />
          <DestructiveTextButton
            label={t("shared.cancelShared")}
            onPress={() => void confirm()}
            loading={busy}
            testID="shared-cancel-confirm"
          />
        </BottomSheet>
      </View>
    </Modal>
  );
}

function ClosedSheet({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
  const { t } = useLocale();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDone}
      testID="shared-closed-modal"
    >
      <View style={styles.backdrop}>
        <View style={styles.flex} />
        <BottomSheet testID="shared-closed">
          <View style={styles.iconWell}>
            <Ionicons name="refresh" size={22} color={colors.text} />
          </View>
          <AppText variant="title">{t("shared.closedTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {t("shared.closedBody")}
          </AppText>
          <PrimaryButton
            label={t("shared.seeOpenRides")}
            onPress={onDone}
            testID="shared-closed-done"
          />
        </BottomSheet>
      </View>
    </Modal>
  );
}

export default function SharedRideScreen({ rideId }: { rideId: string }) {
  const { t, locale } = useLocale();
  const { row, backChevron } = useDirection();
  const { top } = useSafeAreaInsets();
  const router = useRouter();
  const facade = useOptionalActiveRide();
  const [ride, setRide] = useState<SharedRide | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [party, setParty] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // E1: the backend said fewer seats are left than the party needs.
  const [shortOf, setShortOf] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/shared" as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router is stable
  }, []);

  /** A dispatched ride is followed on the ride screen (UC-R-15). */
  const followLive = useCallback(
    (id: string) => {
      void facade?.track(id);
      router.replace(`/ride/${encodeURIComponent(id)}` as never);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router is stable
    [facade?.track],
  );

  const show = useCallback(
    (next: SharedRide) => {
      if (LIVE.includes(next.state) && next.me) {
        followLive(next.rideId);
        return;
      }
      setRide(next);
    },
    [followLive],
  );

  const load = useCallback(async () => {
    setFailure(null);
    try {
      show(await getSharedRide(rideId));
    } catch (failed) {
      setFailure(failureKind(failed));
    }
  }, [rideId, show]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const subscribe = facade?.subscribeRideEvents;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event) => {
      if (event.type === "shared.occupancy" && event.rideId === rideId) {
        setRide((current) =>
          current
            ? {
                ...current,
                seatsTaken: event.seatsTaken,
                totalSeats: event.totalSeats,
                seatsLeft: Math.max(0, event.totalSeats - event.seatsTaken),
              }
            : current,
        );
      } else if (
        (event.type === "ride.state" || event.type === "ride.updated") &&
        event.ride.id === rideId
      ) {
        void load();
      }
    });
  }, [subscribe, rideId, load]);

  if (!ride) {
    return failure ? (
      <ErrorView kind={failure} onRetry={() => void load()} testID="shared-ride-error" />
    ) : (
      <LoadingView testID="shared-ride-loading" />
    );
  }

  const service = serviceName(
    { nameEn: ride.serviceTypeNameEn, nameAr: ride.serviceTypeNameAr },
    locale,
  );
  const money = (amount: number) =>
    t("m12.approx", { money: formatMoney(amount, ride.currency, locale, t) });
  const me = ride.me && ride.me.status === "joined" ? ride.me : null;
  const gathering = ride.state === "gathering";

  const join = async () => {
    setBusy(true);
    setError(null);
    setShortOf(null);
    try {
      show(await joinSharedRide(ride.rideId, party, paymentMethod));
    } catch (failed) {
      const code = rideErrorCode(failed);
      if (code === "insufficient_seats") {
        const left = rideErrorNumber(failed, "seatsLeft") ?? 0;
        setShortOf(left);
        setRide({
          ...ride,
          seatsLeft: left,
          seatsTaken: Math.max(0, ride.totalSeats - left),
        });
        if (left > 0) setParty(Math.min(party, left));
      } else if (code === "shared_ride_closed") {
        setClosed(true);
      } else if (code === "already_member") {
        void load();
      } else if (code === "active_ride_exists") {
        setError(t("shared.activeRideExists"));
      } else {
        setError(rideErrorMessage(failed, t));
      }
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await startSharedRide(ride.rideId);
      followLive(started.rideId);
    } catch (failed) {
      if (rideErrorCode(failed) === "illegal_state") void load();
      else setError(t("shared.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    setError(null);
    try {
      await leaveSharedRide(ride.rideId);
      back();
    } catch (failed) {
      if (rideErrorCode(failed) === "illegal_state") void load();
      else setError(t("shared.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  let content: React.ReactNode;
  if (!gathering) {
    // Cancelled before dispatch (creator, expiry), or not open any more.
    const body =
      ride.cancellationReason === "shared_expired"
        ? t("shared.endedExpired")
        : ride.isCreator
          ? t("shared.endedYou")
          : t("shared.endedByCreator");
    content = (
      <>
        <AppText variant="title" testID="shared-ride-ended">
          {t("shared.endedTitle")}
        </AppText>
        <AppText variant="body" tone="secondary" testID="shared-ride-ended-body">
          {body}
        </AppText>
        <PrimaryButton
          label={t("shared.seeOpenRides")}
          onPress={back}
          testID="shared-ride-ended-done"
        />
      </>
    );
  } else if (me) {
    // Creator / member view (UC-R-14, UC-R-15).
    const creator = ride.isCreator ?? me.isCreator;
    content = (
      <>
        <View style={styles.head}>
          <View style={[styles.chip, row === "row" ? styles.selfStart : styles.selfEnd]}>
            <AppText variant="caption" weight={800} tone="accent">
              {creator ? t("shared.gatheringCreator") : t("shared.gatheringMember")}
            </AppText>
          </View>
          <AppText variant="title">
            {t("shared.toTitle", { place: placeLabel(ride.destination) })}
          </AppText>
          <AppText variant="caption" weight={400} tone="secondary">
            {`${t("shared.meetAt")} · ${placeLabel(ride.pickup)}`}
          </AppText>
        </View>
        <View style={styles.occupancyBox}>
          <OccupancyBar taken={ride.seatsTaken} total={ride.totalSeats} />
          <View style={[styles.valueRow, { flexDirection: row }]}>
            <AppText variant="heading" style={styles.flex} testID="shared-ride-occupancy">
              {t("shared.seatsTaken", { taken: ride.seatsTaken, total: ride.totalSeats })}
            </AppText>
            <AppText variant="secondary" tone="secondary">
              {creator
                ? t("shared.yourParty", { count: me.partySize })
                : t("shared.yourPartyPay", {
                    count: me.partySize,
                    payment: t(`m12.payment.${me.paymentMethod}`),
                  })}
            </AppText>
          </View>
        </View>
        <View>
          <ValueRow
            label={t("shared.departure")}
            value={departureValue(ride.departure, locale, t)}
          />
          {creator ? (
            <ValueRow
              label={t("shared.perSeatIf", { seats: ride.seatsTaken })}
              value={money(perSeat(ride.estimateTotal, ride.seatsTaken))}
              testID="shared-ride-per-seat"
            />
          ) : (
            <>
              <ValueRow label={t("shared.wholeRide")} value={money(ride.estimateTotal)} />
              <ValueRow
                label={
                  me.partySize === 1
                    ? t("shared.yourSeatIfAll", { seats: ride.totalSeats })
                    : t("shared.yourSeatsIfAll", {
                        party: me.partySize,
                        seats: ride.totalSeats,
                      })
                }
                value={money(
                  perSeat(ride.estimateTotal, ride.totalSeats) * me.partySize,
                )}
                testID="shared-ride-my-share"
              />
            </>
          )}
        </View>
        {error ? <Banner tone="danger" message={error} testID="shared-ride-error-banner" /> : null}
        {creator ? (
          <>
            <PrimaryButton
              label={
                ride.seatsTaken === 1
                  ? t("shared.startOne")
                  : t("shared.startMany", { count: ride.seatsTaken })
              }
              onPress={() => void start()}
              loading={busy}
              testID="shared-ride-start"
            />
            <DestructiveTextButton
              label={t("shared.cancelShared")}
              onPress={() => setCancelOpen(true)}
              testID="shared-ride-cancel"
            />
          </>
        ) : (
          <SecondaryButton
            label={t("shared.leaveFree")}
            onPress={() => void leave()}
            loading={busy}
            testID="shared-ride-leave"
          />
        )}
      </>
    );
  } else {
    // Join view (UC-R-13).
    const maxParty = Math.max(1, ride.seatsLeft);
    const seatsLeftLabel =
      shortOf === 0
        ? t("shared.insufficientNone")
        : shortOf === 1
          ? t("shared.insufficientOne")
          : t("shared.insufficientMany", { count: shortOf ?? 0 });
    content = (
      <>
        <View style={styles.head}>
          <AppText variant="title">
            {t("shared.toTitle", { place: placeLabel(ride.destination) })}
          </AppText>
          {ride.creatorFirstName ? (
            <AppText variant="caption" weight={400} tone="secondary">
              {t("shared.sharedBy", { name: ride.creatorFirstName, service })}
            </AppText>
          ) : null}
        </View>
        <View>
          <FactRow
            leading={<View style={styles.pickupDot} />}
            label={t("shared.meetAt")}
            value={placeLabel(ride.pickup)}
          />
          <FactRow
            icon="time-outline"
            label={t("shared.departure")}
            value={departureRule(ride.departure, locale, t)}
            testID="shared-ride-departure"
          />
          <FactRow
            leading={<SeatDots taken={ride.seatsTaken} total={ride.totalSeats} size={16} />}
            value={t("shared.occupancy", {
              taken: ride.seatsTaken,
              total: ride.totalSeats,
              left: ride.seatsLeft,
            })}
            testID="shared-ride-occupancy"
          />
        </View>
        <View style={styles.priceBox}>
          <ValueRow label={t("shared.wholeRide")} value={money(ride.estimateTotal)} />
          <ValueRow
            label={t("shared.ifAllRide", { seats: ride.totalSeats })}
            value={money(perSeat(ride.estimateTotal, ride.totalSeats))}
            testID="shared-ride-per-seat"
          />
          <AppText variant="caption" weight={400} tone="muted">
            {t("shared.basisNote")}
          </AppText>
        </View>
        <Stepper
          title={t("shared.partyTitle")}
          hint={t("shared.partyHint")}
          value={party}
          min={1}
          max={maxParty}
          onChange={setParty}
          decreaseLabel={t("shared.fewerSeats")}
          increaseLabel={t("shared.moreSeats")}
          testID="shared-ride-party"
        />
        {shortOf !== null ? (
          <Banner
            tone="warning"
            title={seatsLeftLabel}
            message={t("shared.insufficientBody")}
            testID="shared-ride-insufficient"
          />
        ) : null}
        <View style={[styles.payment, { flexDirection: row }]}>
          <Ionicons
            name={paymentMethod === "wallet" ? "wallet-outline" : "cash-outline"}
            size={22}
            color={colors.text}
          />
          <AppText variant="bodyStrong" style={styles.flex} testID="shared-ride-payment">
            {t(`m12.payment.${paymentMethod}`)}
          </AppText>
          <TextButton
            label={t("booking.change")}
            onPress={() =>
              setPaymentMethod((method) => (method === "wallet" ? "cash" : "wallet"))
            }
            testID="shared-ride-payment-change"
          />
        </View>
        {error ? <Banner tone="danger" message={error} testID="shared-ride-error-banner" /> : null}
        <PrimaryButton
          label={
            party === 1 ? t("shared.joinOne") : t("shared.joinMany", { count: party })
          }
          onPress={() => void join()}
          disabled={shortOf === 0}
          loading={busy}
          testID="shared-ride-join"
        />
      </>
    );
  }

  return (
    <MapScreen
      testID="shared-ride-screen"
      map={
        <RideMap
          pickup={ride.pickup}
          stops={[]}
          destination={ride.destination}
          noticeTop={top + 72}
        />
      }
      floating={
        <MapFab
          icon={backChevron}
          accessibilityLabel={t("common.back")}
          onPress={back}
          testID="shared-ride-back"
        />
      }
      sheet={
        <BottomSheet style={styles.sheet} testID="shared-ride-sheet">
          <ScrollView contentContainerStyle={styles.sheetContent}>{content}</ScrollView>
          <CancelSharedSheet
            visible={cancelOpen}
            onClose={() => setCancelOpen(false)}
            onConfirm={async (reason, note) => {
              const cancelled = await cancelSharedRide(ride.rideId, reason, note);
              setCancelOpen(false);
              show(cancelled);
            }}
          />
          <ClosedSheet
            visible={closed}
            onDone={() => {
              setClosed(false);
              back();
            }}
          />
        </BottomSheet>
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  sheet: {
    maxHeight: "86%",
  },
  sheetContent: {
    gap: spacing.md,
  },
  head: {
    gap: spacing.xs,
  },
  chip: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  selfStart: {
    alignSelf: "flex-start",
  },
  selfEnd: {
    alignSelf: "flex-end",
  },
  fact: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  pickupDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 5,
    backgroundColor: colors.text,
  },
  valueRow: {
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 40,
  },
  priceBox: {
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  occupancyBox: {
    gap: 10,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceFill,
  },
  payment: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,16,24,0.48)",
  },
  iconWell: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  reason: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: {
    borderColor: colors.accent,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
});
