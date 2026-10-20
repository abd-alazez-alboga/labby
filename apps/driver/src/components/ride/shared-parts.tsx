import type { TFunction } from "i18next";
import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import type { Ride } from "../../api/ride-types";
import { pendingMembers } from "../../api/ride-types";
import type { MemberView } from "../../api/scheduled-types";
import type { DriverRideContextValue } from "../../rides/DriverRideProvider";
import {
  formatClock,
  formatMoney,
  formatNumber,
  formatTime,
  placeLabel,
} from "../../rides/format";
import { useNow } from "../../rides/use-now";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  OutlineButton,
  PrimaryButton,
  SafeScrollView,
  StatusChip,
  useDirection,
  useSafeBottomBar,
} from "../ui";
import type { Tone } from "../ui";
import { ProgressBar, RiderAvatar } from "./ride-parts";

/**
 * M12 shared rides on the driver's ride flow (UC-D-13), artboards "Members
 * at pickup", "Mark absent", "Per-member chats" and "Per-member collection"
 * (EN + AR). One pickup, one destination; every party is listed with its
 * first name (never phones), party size and payment method; the no-show
 * and the money are per party (`/driver/rides/{id}/members/{memberId}/…`).
 */

/** The party's display name: its first name, or "Party 2". */
export function memberName(
  t: TFunction,
  member: MemberView,
  index: number,
  language: string,
): string {
  return (
    member.firstName?.trim() ||
    t("ride.shared.party", { n: formatNumber(index + 1, language) })
  );
}

/** "Party of 2 · Cash". */
function memberSubtitle(
  t: TFunction,
  member: MemberView,
  language: string,
): string {
  return t("ride.shared.memberSubtitle", {
    party: t(
      member.partySize === 1 ? "ride.shared.partyOfOne" : "ride.shared.partyOf",
      { count: formatNumber(member.partySize, language) },
    ),
    payment: t(`ride.payment.${member.paymentMethod}`),
  });
}

/** Parties the driver sees at pickup (pre-dispatch leavers are gone). */
export function visibleMembers(ride: Ride): MemberView[] {
  return (ride.shared?.members ?? []).filter((member) => member.status !== "left");
}

/** "4 seats · 3 parties" for the offer and the ride sheets. */
export function seatsAndParties(
  t: TFunction,
  seats: number,
  parties: number,
  language: string,
): string {
  return t("ride.shared.seatsAndParties", {
    seats: formatNumber(seats, language),
    parties: formatNumber(parties, language),
  });
}

function MemberRow({
  member,
  name,
  trailing,
  last,
}: {
  member: MemberView;
  name: string;
  trailing: React.ReactNode;
  last: boolean;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  return (
    <View
      style={[styles.memberRow, !last && styles.divider, flipRows && styles.rowReverse]}
      testID={`member-${member.memberId}`}
    >
      <RiderAvatar firstName={name} />
      <View style={styles.grow}>
        <AppText variant="bodyStrong" weight="800">
          {member.isCreator ? t("ride.shared.creator", { name }) : name}
        </AppText>
        <AppText variant="caption" weight="400" color={colors.textSecondary}>
          {memberSubtitle(t, member, language)}
        </AppText>
      </View>
      {trailing}
    </View>
  );
}

/**
 * Artboard "Mark absent (E1)": the fee consequence, Keep waiting / Mark
 * absent. Rendered over the whole ride screen (like the cancel sheet).
 */
export function NoShowConfirmSheet({
  ctx,
  ride,
  memberId,
  onClose,
}: {
  ctx: DriverRideContextValue;
  ride: Ride;
  memberId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const bottom = useSafeBottomBar();
  const members = visibleMembers(ride);
  const member = members.find((item) => item.memberId === memberId) ?? null;
  if (!member || member.status !== "joined") return null;
  const name = memberName(t, member, members.indexOf(member), language);
  const others = members.filter(
    (item) => item.status === "joined" && item.memberId !== memberId,
  ).length;
  const busy = ctx.pending === "memberNoShow";
  const error = ctx.error?.action === "memberNoShow" ? ctx.error : null;
  return (
    <View style={styles.overlay} testID="member-no-show-sheet">
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t("ride.shared.keepWaiting")}
        onPress={busy ? undefined : onClose}
      />
      <View style={[styles.sheet, { paddingBottom: bottom }]}>
        <View style={styles.handle} />
        <AppText variant="title" testID="member-no-show-title">
          {t("ride.shared.noShowTitle", { name })}
        </AppText>
        <AppText color={colors.textSecondary}>
          {others > 0
            ? t("ride.shared.noShowCopy", { name })
            : t("ride.shared.noShowCopyLast", { name })}
        </AppText>
        {error?.kind === "noShowTooEarly" ? (
          <Banner
            tone="warning"
            message={
              error.availableAt
                ? t("ride.cancel.noShowTooEarlyAt", {
                    time: formatTime(error.availableAt, language),
                  })
                : t("ride.cancel.noShowTooEarly")
            }
            testID="member-no-show-too-early"
          />
        ) : null}
        {error && (error.kind === "network" || error.kind === "server") ? (
          <Banner
            tone="danger"
            message={t(`ride.errors.${error.kind}`)}
            testID={`member-no-show-error-${error.kind}`}
          />
        ) : null}
        <View style={styles.buttons}>
          <PrimaryButton
            title={t("ride.shared.keepWaiting")}
            size="large"
            onPress={onClose}
            disabled={busy}
            testID="member-no-show-keep"
          />
          <OutlineButton
            title={t("ride.shared.markAbsent")}
            tone="danger"
            onPress={() => {
              void ctx.markMemberNoShow(member.memberId).then((done) => {
                if (done) onClose();
              });
            }}
            busy={busy}
            testID="member-no-show-confirm"
          />
        </View>
      </View>
    </View>
  );
}

const STATUS_TONE: Partial<Record<MemberView["status"], Tone>> = {
  no_show: "danger",
  cancelled: "neutral",
};

/**
 * Artboard "Members at pickup" (UC-D-13 step 2 / E1): the waiting timer and
 * free wait as on a one-rider pickup, then every party with an "Absent"
 * button that unlocks when the region's wait grace is over. Start ride,
 * the per-member Chats list and Cancel follow.
 */
export function SharedPickupSheet({
  ctx,
  ride,
  onCancel,
  onMarkAbsent,
}: {
  ctx: DriverRideContextValue;
  ride: Ride;
  onCancel: () => void;
  /** Opens the confirm sheet (rendered by the ride screen). */
  onMarkAbsent: (memberId: string) => void;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const router = useRouter();
  const now = useNow(true, 500);
  const arrivedAt = ride.timeline.driverArrivedAt
    ? Date.parse(ride.timeline.driverArrivedAt)
    : null;
  const graceEndsAt = ride.waitGraceEndsAt ? Date.parse(ride.waitGraceEndsAt) : null;
  const waited = arrivedAt !== null ? now - arrivedAt : 0;
  const graceLeft = graceEndsAt !== null ? graceEndsAt - now : 0;
  const noShowAllowed = graceEndsAt !== null && graceLeft <= 0;
  const graceTotal =
    arrivedAt !== null && graceEndsAt !== null ? graceEndsAt - arrivedAt : 0;
  const members = visibleMembers(ride);
  const joined = members.filter((member) => member.status === "joined");
  const busy = ctx.pending !== null;
  const error = ctx.error?.action === "start" ? ctx.error : null;
  const shared = ride.shared;

  return (
    <View style={styles.group} testID="shared-pickup-sheet">
      <View style={[styles.row, flipRows && styles.rowReverse]}>
        <View style={styles.grow}>
          <AppText variant="bodyStrong" color={colors.textSecondary}>
            {t("ride.shared.waitingAt", { place: placeLabel(t, ride.pickup) })}
          </AppText>
          <AppText style={styles.bigTimer} testID="wait-timer">
            {formatClock(waited, language)}
          </AppText>
        </View>
        {shared ? (
          <StatusChip
            tone="accent"
            label={t("ride.shared.chipSeats", {
              seats: formatNumber(shared.seatsTaken, language),
            })}
          />
        ) : null}
      </View>

      {graceEndsAt !== null ? (
        <>
          <ProgressBar
            fraction={graceTotal > 0 ? waited / graceTotal : 1}
            testID="wait-progress"
          />
          <AppText color={colors.textSecondary} testID="free-wait-text">
            {noShowAllowed
              ? t("ride.shared.freeWaitOver")
              : t("ride.shared.freeWaitEndsIn", {
                  time: formatClock(graceLeft, language),
                })}
          </AppText>
        </>
      ) : null}

      <View testID="shared-members">
        {members.map((member, index) => {
          const name = memberName(t, member, index, language);
          const tone = STATUS_TONE[member.status];
          const trailing =
            member.status === "joined" ? (
              <View style={styles.absentButton}>
                <OutlineButton
                  title={
                    noShowAllowed
                      ? t("ride.shared.absent")
                      : t("ride.shared.absentIn", {
                          time: formatClock(Math.max(0, graceLeft), language),
                        })
                  }
                  onPress={() => {
                    ctx.clearError();
                    onMarkAbsent(member.memberId);
                  }}
                  disabled={!noShowAllowed || busy}
                  accessibilityLabel={t("ride.shared.markNameAbsent", { name })}
                  testID={`member-absent-${member.memberId}`}
                />
              </View>
            ) : tone ? (
              <StatusChip
                tone={tone}
                label={t(`ride.shared.status.${member.status}`)}
                testID={`member-status-${member.memberId}`}
              />
            ) : null;
          return (
            <MemberRow
              key={member.memberId}
              member={member}
              name={name}
              trailing={trailing}
              last={index === members.length - 1}
            />
          );
        })}
      </View>
      <AppText variant="caption" weight="400" color={colors.textMuted}>
        {t("ride.shared.startHint")}
      </AppText>

      {error && (error.kind === "network" || error.kind === "server") ? (
        <Banner
          tone="danger"
          message={t(`ride.errors.${error.kind}`)}
          testID={`ride-action-error-${error.kind}`}
        />
      ) : null}

      <PrimaryButton
        title={t("ride.atPickup.start")}
        size="hero"
        onPress={() => void ctx.start()}
        disabled={busy || joined.length === 0}
        busy={ctx.pending === "start"}
        testID="ride-start"
      />
      <View style={[styles.actions, flipRows && styles.rowReverse]}>
        <View style={styles.grow}>
          <OutlineButton
            title={t("ride.shared.chats", {
              count: formatNumber(joined.length, language),
            })}
            onPress={() =>
              router.push({ pathname: "/shared-chats", params: { rideId: ride.id } })
            }
            testID="shared-chats-open"
          />
        </View>
        <View style={styles.grow}>
          <OutlineButton
            title={t("ride.cancel.open")}
            onPress={onCancel}
            disabled={busy}
            testID="ride-cancel-open"
          />
        </View>
      </View>

    </View>
  );
}

/** The trailing amount + state of one party at completion. */
function CollectRow({
  ctx,
  ride,
  member,
  name,
}: {
  ctx: DriverRideContextValue;
  ride: Ride;
  member: MemberView;
  name: string;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const currency =
    ride.shared?.split?.currency ??
    ride.fare?.components.currency ??
    ride.estimate.components.currency;
  const money = (amount: number) => formatMoney(amount, currency, language);
  const pending = member.status === "completed" && member.paymentStatus === "pending";
  const busy = ctx.pending !== null;
  const mine = ctx.pendingMemberId === member.memberId;

  let subtitle: string;
  let amount: number | null = null;
  let chip: { tone: Tone; label: string } | null = null;
  if (member.status === "completed") {
    amount = pending ? (member.cashDue ?? member.shareAmount ?? null) : (member.shareAmount ?? null);
    if (member.paymentStatus === "pending") {
      subtitle = t("ride.shared.collect.cashShare", {
        party: t(
          member.partySize === 1 ? "ride.shared.partyOfOne" : "ride.shared.partyOf",
          { count: formatNumber(member.partySize, language) },
        ),
      });
    } else if (member.paymentStatus === "paid_wallet") {
      subtitle = t("ride.shared.collect.walletPaid");
      chip = { tone: "success", label: t("ride.shared.collect.paid") };
    } else if (member.paymentStatus === "unpaid") {
      subtitle = t("ride.shared.collect.unpaidBody");
      chip = { tone: "neutral", label: t("ride.shared.collect.unpaid") };
    } else {
      subtitle = t("ride.shared.collect.cashPaid");
      chip = { tone: "success", label: t("ride.shared.collect.paid") };
    }
  } else if (member.status === "no_show") {
    subtitle = t("ride.shared.collect.absentFee");
    amount = member.cancellationFee ?? null;
    chip = { tone: "neutral", label: t("ride.shared.status.no_show") };
  } else {
    subtitle = t("ride.shared.collect.cancelledBody");
    amount = member.cancellationFee ?? null;
    chip = { tone: "neutral", label: t("ride.shared.status.cancelled") };
  }

  return (
    <View
      style={[styles.collectCard, pending && styles.collectCardPending]}
      testID={`collect-${member.memberId}`}
    >
      <View style={[styles.row, flipRows && styles.rowReverse]}>
        <RiderAvatar firstName={name} />
        <View style={styles.grow}>
          <AppText variant="bodyStrong" weight="800">
            {name}
          </AppText>
          <AppText variant="caption" weight="400" color={colors.textSecondary}>
            {subtitle}
          </AppText>
        </View>
        <View style={styles.collectAmount}>
          {amount !== null ? (
            <AppText
              variant={pending ? "heading" : "bodyStrong"}
              weight="800"
              testID={`collect-amount-${member.memberId}`}
            >
              {money(amount)}
            </AppText>
          ) : null}
          {chip ? (
            <StatusChip
              tone={chip.tone}
              label={chip.label}
              testID={`collect-status-${member.memberId}`}
            />
          ) : null}
        </View>
      </View>
      {pending ? (
        <View style={[styles.actions, flipRows && styles.rowReverse]}>
          <View style={styles.grow}>
            <PrimaryButton
              title={t("ride.complete.cashReceived")}
              onPress={() => void ctx.confirmMemberCash(member.memberId)}
              disabled={busy}
              busy={mine && ctx.pending === "memberCash"}
              testID={`collect-cash-${member.memberId}`}
            />
          </View>
          <View style={styles.grow}>
            <OutlineButton
              title={t("ride.shared.collect.didNotPay")}
              onPress={() => void ctx.markMemberUnpaid(member.memberId)}
              disabled={busy}
              busy={mine && ctx.pending === "memberUnpaid"}
              testID={`collect-unpaid-${member.memberId}`}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Artboard "Per-member collection" (UC-D-13 step 3, RIDE-P4): the stored
 * split (fare ÷ boarded seats = per seat, server amounts only), then one
 * card per party — cash parties get "Cash received" / "Didn't pay"
 * (per-member cash-confirm / mark-unpaid), wallet parties show as paid,
 * absent parties their fee. Done (the one primary, W23) unlocks once every
 * payment is settled; until then the ride stays open.
 */
export function SharedCollectScreen({
  ctx,
  ride,
  onDone,
}: {
  ctx: DriverRideContextValue;
  ride: Ride;
  /** Set once every party is settled (the provider's `collected` ride). */
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const bottom = useSafeBottomBar();
  const split = ride.shared?.split ?? null;
  const members = visibleMembers(ride);
  const error =
    ctx.error && (ctx.error.action === "memberCash" || ctx.error.action === "memberUnpaid")
      ? ctx.error
      : null;
  const left = pendingMembers(ride).length;

  return (
    <View style={styles.screen} testID="shared-collect-screen">
      <SafeScrollView safeTop contentContainerStyle={[styles.content, styles.collectContent]}>
        <AppText variant="rowTitle" color={colors.textSecondary} testID="shared-collect-title">
          {t("ride.shared.collect.title")}
        </AppText>
        {split ? (
          <View style={styles.splitCard} testID="split-card">
            <AppText variant="bodyStrong" color={colors.lineStrong}>
              {t("ride.shared.collect.splitLine", {
                fare: formatMoney(split.fareTotal, split.currency, language),
                seats: formatNumber(split.boardedSeats, language),
              })}
            </AppText>
            <AppText style={styles.perSeat} color={colors.onAccent} testID="split-per-seat">
              {t("ride.shared.collect.perSeat", {
                amount: formatMoney(split.perSeatAmount, split.currency, language),
              })}
            </AppText>
          </View>
        ) : null}
        {members.map((member, index) => (
          <CollectRow
            key={member.memberId}
            ctx={ctx}
            ride={ride}
            member={member}
            name={memberName(t, member, index, language)}
          />
        ))}
        {error ? (
          <Banner
            tone="danger"
            message={t(`ride.errors.${error.kind === "server" ? "server" : "network"}`)}
            testID="collect-error"
          />
        ) : null}
        <AppText variant="caption" weight="400" color={colors.textMuted} testID="collect-hint">
          {t("ride.shared.collect.hint")}
        </AppText>
      </SafeScrollView>
      <View style={[styles.collectFooter, { paddingBottom: bottom }]}>
        <PrimaryButton
          title={t("ride.shared.collect.done")}
          onPress={() => onDone?.()}
          disabled={left > 0 || !onDone}
          testID="collect-done"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.ms },
  rowReverse: { flexDirection: "row-reverse" },
  grow: { flex: 1 },
  bigTimer: { fontSize: 40, lineHeight: 46, fontWeight: "800" },
  memberRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    paddingVertical: spacing.sm,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  absentButton: { minWidth: 112 },
  actions: { flexDirection: "row", gap: 10 },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.shadow,
    opacity: 0.48,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: 10,
    paddingHorizontal: spacing.ml,
    gap: 14,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.grabHandle,
  },
  buttons: { gap: 10 },
  screen: { flex: 1, backgroundColor: colors.surface },
  content: {
    paddingTop: spacing.xl + spacing.sm,
    paddingHorizontal: spacing.ml,
    gap: spacing.ms,
  },
  collectContent: { paddingBottom: spacing.ms },
  collectFooter: {
    paddingHorizontal: spacing.ml,
    paddingTop: spacing.ms,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  splitCard: {
    backgroundColor: colors.text,
    borderRadius: 20,
    padding: spacing.ml,
    gap: 4,
  },
  perSeat: { fontSize: 34, lineHeight: 40, fontWeight: "800" },
  collectCard: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: spacing.ms,
  },
  collectCardPending: { borderWidth: 2, borderColor: colors.text },
  collectAmount: { alignItems: "flex-end", gap: 2 },
});
