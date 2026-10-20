import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import type { ComfortPreferences, Place } from "../../api/ride-types";
import { isolateDigits } from "../../money/format";
import type {
  RideNotice,
  RideNoticeDetail,
} from "../../rides/DriverRideProvider";
import { formatTime, placeLabel } from "../../rides/format";
import { colors, shadows, spacing } from "../../theme/tokens";
import { AppText, Banner, Icon, TextButton, useDirection } from "../ui";
import type { IconName } from "../ui";

/**
 * Building blocks shared by the ride screens (design canvas: Driver offer,
 * To pickup, At pickup, In ride, Complete, Cancel).
 */

/** Secondary text on the near-black instruction / cash cards. */
const ON_DARK_MUTED = colors.lineStrong;

/**
 * The offer countdown ring (52 px): the accent arc is the share of the
 * window left, drawn clockwise from 12 o'clock with two clipped half discs
 * (no SVG dependency); the seconds left sit in the middle.
 */
export function CountdownRing({
  fraction,
  label,
  accessibilityLabel,
  testID,
}: {
  fraction: number;
  label: string;
  accessibilityLabel: string;
  testID?: string;
}) {
  const p = Math.min(1, Math.max(0, fraction));
  const firstHalf = Math.min(p, 0.5) * 360;
  const secondHalf = Math.max(0, p - 0.5) * 360;
  return (
    <View
      style={ring.frame}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {/* Right half: 0 … 50 %. */}
      <View style={[ring.clip, { left: RING / 2 }]}>
        <View
          style={[
            ring.disc,
            { left: -RING / 2, transform: [{ rotate: `${firstHalf}deg` }] },
          ]}
        >
          <View style={[ring.half, { left: 0 }]} />
        </View>
      </View>
      {/* Left half: 50 … 100 %. */}
      <View style={[ring.clip, { left: 0 }]}>
        <View
          style={[
            ring.disc,
            { left: 0, transform: [{ rotate: `${secondHalf}deg` }] },
          ]}
        >
          <View style={[ring.half, { left: RING / 2 }]} />
        </View>
      </View>
      <View style={ring.inner}>
        <AppText variant="rowTitle" weight="800" align="center">
          {label}
        </AppText>
      </View>
    </View>
  );
}

const RING = 52;
const RING_STROKE = 5;
const ring = StyleSheet.create({
  frame: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    overflow: "hidden",
    backgroundColor: colors.line,
  },
  clip: {
    position: "absolute",
    top: 0,
    width: RING / 2,
    height: RING,
    overflow: "hidden",
  },
  disc: { position: "absolute", top: 0, width: RING, height: RING },
  half: {
    position: "absolute",
    top: 0,
    width: RING / 2,
    height: RING,
    backgroundColor: colors.accent,
  },
  inner: {
    position: "absolute",
    top: RING_STROKE,
    left: RING_STROKE,
    width: RING - RING_STROKE * 2,
    height: RING - RING_STROKE * 2,
    borderRadius: RING / 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});

/** 6 px progress bar (the free-wait window). */
export function ProgressBar({
  fraction,
  tone = "accent",
  testID,
}: {
  fraction: number;
  /** I61: `warning` fills amber (the near-floor banner, board DriverBalance). */
  tone?: "accent" | "warning";
  testID?: string;
}) {
  const { flipRows } = useDirection();
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const width = `${percent}%` as const;
  return (
    <View
      style={[styles.bar, flipRows && styles.rowReverse]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      testID={testID}
    >
      <View
        style={[
          styles.barFill,
          tone === "warning" && styles.barFillWarning,
          { width },
        ]}
        testID={testID && `${testID}-fill`}
      />
    </View>
  );
}

/** 56 px round avatar with the rider's initial (no photo for riders). */
export function RiderAvatar({ firstName }: { firstName: string }) {
  return (
    <View style={styles.avatar}>
      <AppText variant="heading" color={colors.accent} align="center">
        {firstName.trim().charAt(0).toUpperCase()}
      </AppText>
    </View>
  );
}

const COMFORT_ICONS: Record<keyof ComfortPreferences, IconName> = {
  temperature: "thermometer-outline",
  conversation: "chatbox-ellipses-outline",
  music: "musical-notes-outline",
};

const COMFORT_KEYS: (keyof ComfortPreferences)[] = [
  "temperature",
  "conversation",
  "music",
];

/** Localized labels of the rider's comfort preferences (temperature, chat, music). */
export function comfortLabels(
  t: TFunction,
  comfort: ComfortPreferences,
): string[] {
  return COMFORT_KEYS.map((key) => t(`ride.comfort.${key}.${comfort[key]}`));
}

/** 36 px comfort-preference chips (UC-D-07, USR-03). */
export function ComfortChips({
  comfort,
  testID,
}: {
  comfort: ComfortPreferences;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  return (
    <View
      style={[styles.chips, flipRows && styles.rowReverse]}
      testID={testID}
    >
      {COMFORT_KEYS.map((key) => (
        <View
          key={key}
          style={[styles.chip, flipRows && styles.rowReverse]}
          testID={`${testID ?? "comfort"}-${key}`}
        >
          <Icon name={COMFORT_ICONS[key]} size={16} />
          <AppText variant="label" weight="700">
            {t(`ride.comfort.${key}.${comfort[key]}`)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

export interface RouteStep {
  key: string;
  caption: string;
  place: Place;
  /** The final drop-off gets the accent square. */
  final?: boolean;
  testID?: string;
}

/** Pickup → stops → drop-off with the dot-and-line rail. */
export function RouteSteps({ steps }: { steps: RouteStep[] }) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  return (
    <View style={[styles.route, flipRows && styles.rowReverse]}>
      <View style={styles.rail}>
        {steps.map((step, index) => (
          <React.Fragment key={step.key}>
            {index > 0 ? <View style={styles.railLine} /> : null}
            <View style={step.final ? styles.railEnd : styles.railDot} />
          </React.Fragment>
        ))}
      </View>
      <View style={styles.routeText}>
        {steps.map((step) => (
          <View key={step.key} style={styles.step} testID={step.testID}>
            <AppText variant="caption" color={colors.textMuted}>
              {step.caption}
            </AppText>
            <AppText variant="rowTitle" weight="800">
              {placeLabel(t, step.place)}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The near-black instruction card at the top of a map screen: the one
 * thing to read at a glance (distance / ETA, next place).
 */
export function InstructionCard({
  icon,
  badge,
  title,
  subtitle,
  subtitleFirst,
  testID,
}: {
  icon?: IconName;
  badge?: string;
  title: string;
  subtitle: string;
  /** The caption above the title (in-ride "Drop-off · 4 min"). */
  subtitleFirst?: boolean;
  testID?: string;
}) {
  const { flipRows } = useDirection();
  return (
    <View
      style={[styles.instruction, flipRows && styles.rowReverse]}
      testID={testID}
    >
      {badge ? (
        <View style={styles.badge}>
          <AppText variant="rowTitle" color={colors.onAccent} align="center">
            {badge}
          </AppText>
        </View>
      ) : icon ? (
        <Icon name={icon} size={34} color={colors.onAccent} />
      ) : null}
      <View style={styles.instructionText}>
        {subtitleFirst ? (
          <AppText color={ON_DARK_MUTED} testID={testID && `${testID}-subtitle`}>
            {subtitle}
          </AppText>
        ) : null}
        <AppText
          variant="title"
          color={colors.onAccent}
          testID={testID && `${testID}-title`}
        >
          {title}
        </AppText>
        {!subtitleFirst ? (
          <AppText color={ON_DARK_MUTED} testID={testID && `${testID}-subtitle`}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/** "You're online" pill floating over the map during an offer. */
export function OnlinePill() {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  return (
    <View style={[styles.pill, flipRows && styles.rowReverse]}>
      <View style={styles.pillDot} />
      <AppText variant="label" weight="700">
        {t("ride.online")}
      </AppText>
    </View>
  );
}

/** UC-D-08 E1 — the server says our stream is stale. */
export function StreamLostBanner() {
  const { t } = useTranslation();
  return (
    <Banner
      tone="warning"
      icon="cellular-outline"
      title={t("ride.connectionLostTitle")}
      message={t("ride.connectionLostBody")}
      testID="ride-connection-lost"
    />
  );
}

const NOTICE_TONES: Record<RideNotice, "neutral" | "success" | "warning"> = {
  offerExpired: "neutral",
  offerCancelled: "warning",
  offerClosed: "neutral",
  offerGone: "neutral",
  riderCancelled: "warning",
  rideCancelled: "neutral",
  cashConfirmed: "success",
  markedUnpaid: "neutral",
  paymentSettled: "neutral",
  scheduledLive: "success",
  scheduledReleased: "warning",
  scheduledRiderBusy: "neutral",
};

/** "Sat 07:30" (Western digits) — the scheduled pickup the notice names. */
function pickupWhen(
  detail: RideNoticeDetail,
  language: string,
): { time: string | null; when: string | null } {
  const locale = language === "ar" ? "ar-u-nu-latn" : "en-GB";
  const weekday = (date: Date) => {
    try {
      return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
    } catch {
      return null;
    }
  };
  if (detail.scheduledAt) {
    const date = new Date(detail.scheduledAt);
    if (!Number.isNaN(date.getTime())) {
      const time = formatTime(detail.scheduledAt, language);
      const day = weekday(date);
      return { time, when: day ? `${day} ${time}` : null };
    }
  }
  const time = detail.pickupTime ?? null;
  if (time && detail.pickupDate) {
    const [year, month, day] = detail.pickupDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const name = Number.isNaN(date.getTime()) ? null : weekday(date);
    return { time, when: name ? `${name} ${time}` : null };
  }
  return { time, when: null };
}

/**
 * W22 (board D12Notices): the scheduled notices are titled with the ride's
 * time (and the rider's name) when known, and say what the event costs —
 * a release counts, a rider-busy cancel does not.
 */
function scheduledTitle(
  t: TFunction,
  notice: RideNotice,
  detail: RideNoticeDetail | null,
  language: string,
): string | null {
  if (notice !== "scheduledReleased" && notice !== "scheduledRiderBusy")
    return null;
  const { time, when } = pickupWhen(detail ?? {}, language);
  if (notice === "scheduledReleased") {
    return time
      ? t("ride.notice.scheduledReleasedTitle", {
          time: isolateDigits(time, language),
        })
      : t("ride.notice.scheduledReleasedTitleGeneric");
  }
  const name = detail?.riderName?.trim();
  if (name && when) {
    return t("ride.notice.scheduledRiderBusyTitle", {
      name,
      when: isolateDigits(when, language),
    });
  }
  return when
    ? t("ride.notice.scheduledRiderBusyTitleWhen", {
        when: isolateDigits(when, language),
      })
    : t("ride.notice.scheduledRiderBusyTitleGeneric");
}

/** The short notice after an offer / ride went away. */
export function RideNoticeBanner({
  notice,
  detail = null,
  onDismiss,
}: {
  notice: RideNotice;
  detail?: RideNoticeDetail | null;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const liveAt =
    notice === "scheduledReleased" ? detail?.liveAt?.trim() : null;
  return (
    <Banner
      tone={NOTICE_TONES[notice]}
      title={scheduledTitle(t, notice, detail, language) ?? undefined}
      message={
        liveAt
          ? t("ride.notice.scheduledReleasedLive", {
              liveAt: isolateDigits(liveAt, language),
            })
          : t(`ride.notice.${notice}`)
      }
      messageTestID="ride-notice-text"
      testID={`ride-notice-${notice}`}
    >
      <TextButton
        title={t("ride.dismiss")}
        onPress={onDismiss}
        testID="ride-notice-dismiss"
      />
    </Banner>
  );
}

/** One fare line: muted label, bold amount (min 38 px tall). */
export function FareLine({
  label,
  value,
  valueColor,
  testID,
}: {
  label: string;
  value: string;
  /** e.g. the accent for tip credits (M8 artboards). */
  valueColor?: string;
  testID?: string;
}) {
  const { flipRows } = useDirection();
  return (
    <View
      style={[styles.fareLine, flipRows && styles.rowReverse]}
      testID={testID}
    >
      <AppText color={colors.textSecondary} style={styles.fareLabel}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" color={valueColor} align="auto">
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  rowReverse: { flexDirection: "row-reverse" },
  bar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.line,
    overflow: "hidden",
    flexDirection: "row",
  },
  barFill: { height: 6, backgroundColor: colors.accent },
  barFillWarning: { backgroundColor: colors.warning },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    height: 36,
    paddingHorizontal: spacing.ms,
    borderRadius: 18,
    backgroundColor: colors.surfaceFill,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  route: { flexDirection: "row", gap: spacing.ms },
  rail: { alignItems: "center", paddingTop: 6, paddingBottom: 10 },
  railDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.text,
  },
  railEnd: { width: 12, height: 12, backgroundColor: colors.accent },
  railLine: {
    width: 2,
    flex: 1,
    minHeight: 24,
    backgroundColor: colors.grabHandle,
    marginVertical: spacing.xs,
  },
  routeText: { flex: 1, gap: 14 },
  step: { gap: 2 },
  instruction: {
    borderRadius: 18,
    backgroundColor: colors.text,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    ...shadows.floating,
  },
  instructionText: { flex: 1, gap: 2 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: colors.onAccent,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    alignSelf: "center",
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: 20,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.floating,
  },
  pillDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.online,
  },
  fareLine: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  fareLabel: { flexShrink: 1 },
});

