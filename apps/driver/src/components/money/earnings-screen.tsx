import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import { getEarningsSummary, getTripEarnings } from "../../api/money";
import type {
  CommissionStatus,
  EarningsPeriod,
  EarningsSummary,
  TripEarning,
} from "../../api/money-types";
import {
  formatAmountValue,
  formatSignedMoney,
  isolateDigits,
  MINUS,
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
  ListRow,
  LoadingState,
  Muted,
  Screen,
  StatusChip,
  TextButton,
  useDirection,
} from "../ui";
import { ProgressBar } from "../ride/ride-parts";

/** Secondary text on the near-black total card. */
const ON_DARK_MUTED = colors.lineStrong;

const PERIODS: EarningsPeriod[] = ["weekly", "monthly"];
const PERIOD_KEYS: Record<EarningsPeriod, string> = {
  weekly: "earnings.week",
  monthly: "earnings.month",
};

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
    t("earnings.trips", { count: amount(summary.trips) }),
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

/** COM-02 — this week's rate and the next-tier progress (weekly view). */
function TierCard({ commission }: { commission: CommissionStatus }) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const trips = commission.currentWeekTrips ?? 0;
  const next = commission.nextTier ?? null;
  const fraction = next ? Math.min(1, trips / next.weeklyTripsAbove) : 1;
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
              count: isolateDigits(formatAmountValue(trips), language),
              needed: isolateDigits(
                `${formatAmountValue(next.weeklyTripsAbove)}+`,
                language,
              ),
              percent: isolateDigits(
                `${formatAmountValue(next.percent)}%`,
                language,
              ),
            })
          : t("earnings.tierBest", {
              count: isolateDigits(formatAmountValue(trips), language),
            })}
      </AppText>
    </View>
  );
}

/** One per-trip row: time + date, itemized subtitle, signed net. */
function TripRow({
  earning,
  last,
}: {
  earning: TripEarning;
  last: boolean;
}) {
  const { t } = useTranslation();
  const { language } = useDirection();
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
    />
  );
}

type SummaryLoad =
  | { status: "loading" }
  | { status: "loaded"; summary: EarningsSummary }
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
        if (mounted.current)
          setSummaryLoad({ status: "error", kind: failureKindOf(caught) });
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
  const balanceEntry =
    money?.alert ?? money?.balance?.balances[0] ?? null;

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
            balanceEntry.status !== "ok" ? (
              <StatusChip
                label={formatSignedMoney(
                  balanceEntry.balance,
                  balanceEntry.currency,
                  language,
                )}
                tone={balanceEntry.status === "blocked" ? "danger" : "warning"}
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
});
