import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import { ApiError } from "../../api/client";
import { getEarningsSummary, getTripEarnings } from "../../api/money";
import { isFeeOnlyEarning } from "../../api/money-types";
import type {
  CommissionStatus,
  EarningsPeriod,
  EarningsSummary,
  NextTier,
  TripEarning,
} from "../../api/money-types";
import {
  formatAmountValue,
  formatSignedMoney,
  isolateDigits,
  MINUS,
  pluralCategory,
} from "../../money/format";
import { useOptionalDriverMoney } from "../../money/DriverMoneyProvider";
import { localRange, periodLabel, samePeriod, stepAnchor } from "../../money/periods";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { formatDate, todayIso } from "../../onboarding/dates";
import { formatTime } from "../../rides/format";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  Chevron,
  FailureState,
  Icon,
  ListRow,
  LoadingState,
  Muted,
  Screen,
  StatusChip,
  TextButton,
  useDirection,
} from "../ui";
import { ProgressBar } from "../ride/ride-parts";
import type { PendingRating } from "../../api/trust-types";
import { useOptionalRatingPrompt } from "../../trust/RatingPromptProvider";
import { countCopy, daysLeft } from "../../trust/format";

/** Secondary text on the near-black total card. */
const ON_DARK_MUTED = colors.lineStrong;

const PERIODS: EarningsPeriod[] = ["weekly", "monthly"];
const PERIOD_KEYS: Record<EarningsPeriod, string> = {
  weekly: "earnings.week",
  monthly: "earnings.month",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "1 trip" / "38 trips" — "رحلة واحدة" / "⁦38⁩ رحلة" (plural-correct). */
function tripCount(t: Translate, count: number, language: string): string {
  return t(`earnings.tripCount.${pluralCategory(count, language)}`, {
    value: isolateDigits(formatAmountValue(count), language),
  });
}

/**
 * Trips this week that earn the next tier: the backend's condition is
 * strictly `weeklyTrips > weeklyTripsAbove` (CommissionPolicy), so one more.
 */
export function tripsForNextTier(next: NextTier): number {
  return next.weeklyTripsAbove + 1;
}

/** Week / Month segmented toggle (48 px touch targets). */
function PeriodToggle({
  period,
  onChange,
}: {
  period: EarningsPeriod;
  onChange: (next: EarningsPeriod) => void;
}) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  return (
    <View
      style={[styles.toggle, flipRows && styles.rowReverse]}
      accessibilityRole="tablist"
    >
      {PERIODS.map((option) => {
        const selected = option === period;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={[styles.toggleButton, selected && styles.toggleSelected]}
            testID={`earnings-period-${option}`}
          >
            <AppText
              variant="caption"
              weight={selected ? "800" : "700"}
              color={selected ? colors.text : colors.textSecondary}
              align="center"
            >
              {t(PERIOD_KEYS[option])}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** ‹ Mon 6 – Sun 12 Oct › period stepper. */
function PeriodStepper({
  label,
  onStep,
  nextDisabled,
}: {
  label: string;
  onStep: (direction: -1 | 1) => void;
  nextDisabled: boolean;
}) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  return (
    <View style={[styles.stepper, flipRows && styles.rowReverse]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("earnings.previousPeriod")}
        onPress={() => onStep(-1)}
        style={styles.stepButton}
        testID="earnings-prev"
      >
        <Chevron direction="back" size={18} color={colors.text} />
      </Pressable>
      <AppText
        variant="body"
        weight="800"
        align="center"
        style={styles.stepLabel}
        testID="earnings-range"
      >
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("earnings.nextPeriod")}
        accessibilityState={{ disabled: nextDisabled }}
        onPress={() => {
          if (!nextDisabled) onStep(1);
        }}
        style={[styles.stepButton, nextDisabled && styles.stepDisabled]}
        testID="earnings-next"
      >
        <Chevron direction="forward" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

/** The dark period-total card (net, trips · fares · tips · commission). */
function TotalCard({
  period,
  summary,
}: {
  period: EarningsPeriod;
  summary: EarningsSummary;
}) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const amount = (value: number, negative = false) =>
    isolateDigits(
      `${negative && value > 0 ? MINUS : ""}${formatAmountValue(value)}`,
      language,
    );
  const meta = [
    tripCount(t, summary.trips, language),
    t("earnings.fares", { amount: amount(summary.fares) }),
    t("earnings.tips", { amount: amount(summary.tips) }),
    t("earnings.commission", { amount: amount(summary.commission, true) }),
  ].join(" · ");
  return (
    <View style={styles.totalCard} testID="earnings-total-card">
      <AppText variant="label" weight="700" color={ON_DARK_MUTED}>
        {t(period === "weekly" ? "earnings.totalWeekly" : "earnings.totalMonthly")}
      </AppText>
      <AppText style={styles.totalAmount} color={colors.onAccent} testID="earnings-net">
        {formatSignedMoney(summary.net, summary.currency, language)}
      </AppText>
      <AppText variant="caption" weight="600" color={ON_DARK_MUTED} testID="earnings-meta">
        {meta}
      </AppText>
    </View>
  );
}

/**
 * COM-02 — this week's rate and the next-tier progress (weekly view). The
 * backend's tier condition is strictly greater-than `weeklyTripsAbove`, so
 * the driver needs `weeklyTripsAbove + 1` trips (W14).
 */
function TierCard({ commission }: { commission: CommissionStatus }) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const trips = commission.currentWeekTrips ?? 0;
  const next = commission.nextTier ?? null;
  const needed = next ? tripsForNextTier(next) : 0;
  const fraction = next ? Math.min(1, trips / needed) : 1;
  return (
    <View style={styles.tierCard} testID="earnings-tier-card">
      <AppText variant="body" weight="800" testID="earnings-tier-heading">
        {t("earnings.tierHeading", {
          percent: isolateDigits(
            `${formatAmountValue(commission.percent)}%`,
            language,
          ),
        })}
      </AppText>
      <ProgressBar fraction={fraction} testID="earnings-tier-bar" />
      <AppText variant="caption" weight="400" color={colors.textSecondary} testID="earnings-tier-body">
        {next
          ? t("earnings.tierNext", {
              trips: tripCount(t, trips, language),
              needed: tripCount(t, needed, language),
              percent: isolateDigits(
                `${formatAmountValue(next.percent)}%`,
                language,
              ),
            })
          : t("earnings.tierBest", {
              trips: tripCount(t, trips, language),
            })}
      </AppText>
    </View>
  );
}

/** A fare row's itemized subtitle: method · fare · commission (· tip). */
function tripParts(
  t: Translate,
  earning: TripEarning,
  language: string,
): string[] {
  const parts = [
    t(earning.paymentMethod === "cash" ? "earnings.rowCash" : "earnings.rowWallet"),
    t("earnings.rowFare", {
      amount: isolateDigits(formatAmountValue(earning.fareTotal), language),
    }),
    t("earnings.rowCommission", {
      amount: isolateDigits(
        `${MINUS}${formatAmountValue(earning.commissionAmount)}`,
        language,
      ),
    }),
  ];
  if (earning.tip) {
    parts.push(
      t("earnings.rowTip", {
        amount: isolateDigits(`+${formatAmountValue(earning.tip)}`, language),
      }),
    );
  }
  if (earning.promoCompensation) {
    // M13 ruling 1: the promo discount Labby covered for this ride.
    parts.push(
      t("earnings.rowPromo", {
        amount: isolateDigits(
          `+${formatAmountValue(earning.promoCompensation)}`,
          language,
        ),
      }),
    );
  }
  return parts;
}

/**
 * M11 (UC-S-17 A1): "Rate {name} · N days left" under a trip still inside
 * its rating window (from `GET /ratings/pending?as=driver`).
 */
function RateChip({ pending }: { pending: PendingRating }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language, flipRows } = useDirection();
  const name = pending.counterpartFirstName.trim() || t("ride.theRider");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: "/rate-rider",
          params: {
            rideId: pending.rideId,
            ...(pending.memberId ? { memberId: pending.memberId } : {}),
          },
        })
      }
      style={({ pressed }) => [
        styles.rateChip,
        flipRows && styles.rateChipFlipped,
        pressed && styles.rateChipPressed,
      ]}
      testID={`trip-rate-${pending.rideId}`}
    >
      <Icon name="star-outline" size={16} color={colors.accent} />
      <AppText variant="label" weight="800" color={colors.accent}>
        {t("trust.rate.historyChip", {
          name,
          left: countCopy(
            t,
            "trust.rate.daysLeft",
            daysLeft(pending.windowEndsAt),
            language,
          ),
        })}
      </AppText>
    </Pressable>
  );
}

/** One per-trip row: time + date, itemized subtitle, signed net. */
function TripRow({
  earning,
  last,
  pending,
}: {
  earning: TripEarning;
  last: boolean;
  /** M11: the ride is still rateable. */
  pending?: PendingRating | null;
}) {
  const { t } = useTranslation();
  const { language } = useDirection();
  // W17: a credited cancellation fee is one item — no fare/commission lines.
  const parts = isFeeOnlyEarning(earning)
    ? [t("earnings.rowFee")]
    : tripParts(t, earning, language);
  return (
    <ListRow
      title={`${formatTime(earning.completedAt, language)} · ${formatDate(earning.completedAt, language)}`}
      subtitle={parts.join(" · ")}
      trailing={
        <AppText
          variant="body"
          weight="800"
          color={earning.net > 0 ? colors.accent : colors.text}
          testID={`trip-net-${earning.rideId}`}
        >
          {formatSignedMoney(earning.net, earning.currency, language, {
            alwaysSign: true,
          })}
        </AppText>
      }
      last={last}
      testID={`trip-row-${earning.rideId}`}
    >
      {pending ? <RateChip pending={pending} /> : null}
    </ListRow>
  );
}

type SummaryLoad =
  | { status: "loading" }
  | { status: "loaded"; summary: EarningsSummary }
  /** 404: no operating region yet (never drove) — nothing to sum (W15). */
  | { status: "none" }
  | { status: "error"; kind: FailureKind };

type TripsLoad =
  | { status: "loading" }
  | { status: "loaded"; items: TripEarning[]; page: number; totalPages: number }
  | { status: "error"; kind: FailureKind };

/**
 * UC-D-15 — the Earnings screen (artboard "Driver Earnings"): Week/Month
 * toggle, period stepper, the dark total card, the commission-tier card
 * with next-tier progress (COM-02, from `GET /driver/balance`), and the
 * per-trip list from `GET /driver/earnings`.
 */
export function EarningsScreen() {
  const { t } = useTranslation();
  const { language } = useDirection();
  const router = useRouter();
  const money = useOptionalDriverMoney();
  // M11: rides still rateable (re-read whenever the list opens).
  const ratingPrompts = useOptionalRatingPrompt();
  const refreshRatings = ratingPrompts?.refresh;
  useEffect(() => {
    if (refreshRatings) void refreshRatings();
  }, [refreshRatings]);
  const [period, setPeriod] = useState<EarningsPeriod>("weekly");
  const [anchor, setAnchor] = useState(() => todayIso());
  const [summaryLoad, setSummaryLoad] = useState<SummaryLoad>({ status: "loading" });
  const [tripsLoad, setTripsLoad] = useState<TripsLoad>({ status: "loading" });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadSummary = useCallback(
    async (nextPeriod: EarningsPeriod, nextAnchor: string) => {
      setSummaryLoad({ status: "loading" });
      try {
        const summary = await getEarningsSummary(nextPeriod, nextAnchor);
        if (mounted.current) setSummaryLoad({ status: "loaded", summary });
      } catch (caught) {
        if (!mounted.current) return;
        setSummaryLoad(
          caught instanceof ApiError && caught.status === 404
            ? { status: "none" }
            : { status: "error", kind: failureKindOf(caught) },
        );
      }
    },
    [],
  );

  useEffect(() => {
    void loadSummary(period, anchor);
  }, [loadSummary, period, anchor]);

  const loadTrips = useCallback(async (page: number) => {
    if (page === 0) setTripsLoad({ status: "loading" });
    try {
      const result = await getTripEarnings(page, 20);
      if (!mounted.current) return;
      setTripsLoad((previous) => ({
        status: "loaded",
        items:
          page > 0 && previous.status === "loaded"
            ? [...previous.items, ...result.items]
            : result.items,
        page: result.page,
        totalPages: result.totalPages,
      }));
    } catch (caught) {
      if (mounted.current)
        setTripsLoad({ status: "error", kind: failureKindOf(caught) });
    }
  }, []);

  useEffect(() => {
    void loadTrips(0);
  }, [loadTrips]);

  const range =
    summaryLoad.status === "loaded"
      ? { from: summaryLoad.summary.from, to: summaryLoad.summary.to }
      : localRange(period, anchor);
  const nextDisabled = samePeriod(period, anchor, todayIso());
  const commission = money?.balance?.commission ?? null;
  // Floor status UI only for the operating entry or the server-driven
  // alert; the balances[0] fallback (region unresolved) stays neutral.
  const floorEntry = money?.alert ?? money?.entry ?? null;
  const balanceEntry = floorEntry ?? money?.balance?.balances[0] ?? null;
  const floorStatus = floorEntry?.status ?? "ok";

  return (
    <Screen testID="earnings-screen">
      <View style={styles.titleRow}>
        <AppText variant="display" accessibilityRole="header" testID="earnings-title">
          {t("earnings.title")}
        </AppText>
        <PeriodToggle
          period={period}
          onChange={(next) => {
            if (next !== period) {
              setPeriod(next);
              setAnchor(todayIso());
            }
          }}
        />
      </View>

      <PeriodStepper
        label={periodLabel(period, range.from, range.to, language)}
        nextDisabled={nextDisabled}
        onStep={(direction) => setAnchor(stepAnchor(period, anchor, direction))}
      />

      {summaryLoad.status === "loading" ? (
        <LoadingState testID="earnings-summary-loading" />
      ) : null}
      {summaryLoad.status === "error" ? (
        <FailureState
          kind={summaryLoad.kind}
          onRetry={() => void loadSummary(period, anchor)}
          testID="earnings-summary-error"
        />
      ) : null}
      {summaryLoad.status === "none" ? (
        <Muted testID="earnings-summary-empty">
          {t("earnings.summaryEmpty")}
        </Muted>
      ) : null}
      {summaryLoad.status === "loaded" ? (
        <TotalCard period={period} summary={summaryLoad.summary} />
      ) : null}

      {period === "weekly" && commission ? (
        <TierCard commission={commission} />
      ) : null}

      {balanceEntry ? (
        <ListRow
          icon="wallet-outline"
          title={t("balance.title")}
          chevron
          trailing={
            floorStatus !== "ok" ? (
              <StatusChip
                label={formatSignedMoney(
                  balanceEntry.balance,
                  balanceEntry.currency,
                  language,
                )}
                tone={floorStatus === "blocked" ? "danger" : "warning"}
                testID="earnings-balance-chip"
              />
            ) : (
              <AppText variant="body" weight="700" testID="earnings-balance-amount">
                {formatSignedMoney(
                  balanceEntry.balance,
                  balanceEntry.currency,
                  language,
                )}
              </AppText>
            )
          }
          onPress={() => router.push("/balance")}
          last
          testID="earnings-balance-link"
        />
      ) : null}

      <AppText variant="rowTitle" weight="800" style={styles.tripsHeading}>
        {t("earnings.tripsHeading")}
      </AppText>
      {tripsLoad.status === "loading" ? (
        <LoadingState testID="earnings-trips-loading" />
      ) : null}
      {tripsLoad.status === "error" ? (
        <FailureState
          kind={tripsLoad.kind}
          onRetry={() => void loadTrips(0)}
          testID="earnings-trips-error"
        />
      ) : null}
      {tripsLoad.status === "loaded" ? (
        tripsLoad.items.length === 0 ? (
          <Muted testID="earnings-empty">{t("earnings.empty")}</Muted>
        ) : (
          <View testID="earnings-trips">
            {tripsLoad.items.map((earning, index) => (
              <TripRow
                key={earning.rideId}
                earning={earning}
                last={index === tripsLoad.items.length - 1}
                pending={
                  ratingPrompts?.pending.find(
                    (item) => item.rideId === earning.rideId,
                  ) ?? null
                }
              />
            ))}
            {tripsLoad.page + 1 < tripsLoad.totalPages ? (
              <TextButton
                title={t("earnings.loadMore")}
                onPress={() => void loadTrips(tripsLoad.page + 1)}
                testID="earnings-load-more"
              />
            ) : null}
          </View>
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowReverse: { flexDirection: "row-reverse" },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.ms,
    flexWrap: "wrap",
  },
  toggle: {
    flexDirection: "row",
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    padding: 4,
  },
  toggleButton: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 14,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleSelected: {
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDisabled: { opacity: 0.4 },
  stepLabel: { flex: 1 },
  totalCard: {
    backgroundColor: colors.text,
    borderRadius: 20,
    padding: spacing.ml,
    gap: spacing.xs,
  },
  totalAmount: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: "800",
    letterSpacing: -1,
  },
  tierCard: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: spacing.sm + 2,
  },
  tripsHeading: { marginTop: spacing.xs },
  rateChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.round,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  rateChipFlipped: { flexDirection: "row-reverse", alignSelf: "flex-end" },
  rateChipPressed: { opacity: 0.6 },
});
