import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { getTripEarnings } from "../../api/money";
import type { TripEarning } from "../../api/money-types";
import {
  formatAmountValue,
  formatMoney,
  formatSignedMoney,
  isolateDigits,
} from "../../money/format";
import { useOptionalDriverMoney } from "../../money/DriverMoneyProvider";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { formatDate } from "../../onboarding/dates";
import { formatTime } from "../../rides/format";
import { colors, spacing } from "../../theme/tokens";
import {
  AppText,
  FailureState,
  ListRow,
  LoadingState,
  Muted,
  OutlineButton,
  Screen,
  useDirection,
} from "../ui";
import { FloorBlockedCard, FloorWarningBanner, SettleSteps } from "./floor";

/** Secondary text on the near-black balance card. */
const ON_DARK_MUTED = colors.lineStrong;

/** A typed activity line derived from one trip's COM-01 itemization. */
interface ActivityEntry {
  key: string;
  title: string;
  subtitle: string;
  amount: number;
  currency: string;
  /** Credits render in the accent (artboard "Driver Balance"). */
  credit: boolean;
}

/**
 * The typed recent activity the driver contract exposes (UC-D-16): each
 * `TripEarning` expands into its ledger-shaped parts — the cash-ride
 * commission debit / wallet-ride earning credit (COM-01), the tip and the
 * collected cancellation fee. Amounts are the server's itemized numbers.
 */
export function activityEntries(
  items: TripEarning[],
  t: (key: string, options?: Record<string, unknown>) => string,
  language: string,
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const item of items) {
    const time = formatTime(item.completedAt, language);
    const date = formatDate(item.completedAt, language);
    const fare = isolateDigits(formatAmountValue(item.fareTotal), language);
    const rate = isolateDigits(
      `${formatAmountValue(item.commissionRate)}%`,
      language,
    );
    if (item.paymentMethod === "cash") {
      entries.push({
        key: `${item.rideId}-commission`,
        title: t("balance.commissionTitle", { time }),
        subtitle: t("balance.commissionSub", { date, fare, rate }),
        amount: -item.commissionAmount,
        currency: item.currency,
        credit: false,
      });
    } else {
      entries.push({
        key: `${item.rideId}-earning`,
        title: t("balance.earningTitle", { time }),
        subtitle: t("balance.earningSub", { date, fare, rate }),
        // COM-01: wallet ride credits fare − commission (both server numbers).
        amount: item.fareTotal - item.commissionAmount,
        currency: item.currency,
        credit: true,
      });
    }
    if (item.tip) {
      entries.push({
        key: `${item.rideId}-tip`,
        title: t("balance.tipTitle"),
        subtitle: t("balance.tipSub", { date }),
        amount: item.tip,
        currency: item.currency,
        credit: true,
      });
    }
    if (item.cancellationFee) {
      entries.push({
        key: `${item.rideId}-fee`,
        title: t("balance.feeTitle"),
        subtitle: t("balance.feeSub", { date }),
        amount: item.cancellationFee,
        currency: item.currency,
        credit: true,
      });
    }
  }
  return entries;
}

type ActivityLoad =
  | { status: "loading" }
  | { status: "loaded"; items: TripEarning[] }
  | { status: "error"; kind: FailureKind };

/**
 * UC-D-16 — the Balance screen (artboard "Driver Balance"): the dark
 * "You owe Labby" card per currency, the floor warning / blocked states,
 * typed recent activity and the "How to settle" instructions.
 */
export function BalanceScreen() {
  const { t } = useTranslation();
  const { language } = useDirection();
  const money = useOptionalDriverMoney();
  const [activity, setActivity] = useState<ActivityLoad>({ status: "loading" });
  const [showSteps, setShowSteps] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadActivity = useCallback(async () => {
    setActivity({ status: "loading" });
    try {
      const page = await getTripEarnings(0, 20);
      if (mounted.current)
        setActivity({ status: "loaded", items: page.items });
    } catch (caught) {
      if (mounted.current)
        setActivity({ status: "error", kind: failureKindOf(caught) });
    }
  }, []);

  const moneyReload = money?.reload;
  useEffect(() => {
    void loadActivity();
    if (moneyReload) void moneyReload();
  }, [loadActivity, moneyReload]);

  const view = money?.balance ?? null;
  const main = money?.alert ?? view?.balances[0] ?? null;
  const others = view?.balances.filter((entry) => entry !== main) ?? [];
  const debt = !!main && main.balance < 0;

  return (
    <Screen title={t("balance.title")} testID="balance-screen">
      {!view && money?.loading !== false ? (
        <LoadingState testID="balance-loading" />
      ) : null}
      {!view && money?.error ? (
        <FailureState
          kind={money.error}
          onRetry={() => void money.reload()}
          testID="balance-error"
        />
      ) : null}
      {view && !main ? (
        <Muted testID="balance-empty">{t("balance.empty")}</Muted>
      ) : null}

      {main ? (
        <View style={styles.card} testID="balance-card">
          <AppText variant="label" weight="700" color={ON_DARK_MUTED}>
            {t(debt ? "balance.youOwe" : "balance.yourBalance")}
          </AppText>
          <AppText style={styles.amount} color={colors.onAccent} testID="balance-amount">
            {debt
              ? formatMoney(main.balance, main.currency, language)
              : formatSignedMoney(main.balance, main.currency, language)}
          </AppText>
          <AppText variant="caption" weight="400" color={ON_DARK_MUTED}>
            {t(debt ? "balance.debtHint" : "balance.creditHint")}
          </AppText>
        </View>
      ) : null}

      {others.map((entry) => (
        <ListRow
          key={entry.currency}
          title={entry.currency}
          trailing={
            <AppText variant="body" weight="700">
              {formatSignedMoney(entry.balance, entry.currency, language)}
            </AppText>
          }
          testID={`balance-entry-${entry.currency}`}
        />
      ))}

      {main?.status === "blocked" ? <FloorBlockedCard entry={main} /> : null}
      {main?.status === "warning" ? <FloorWarningBanner entry={main} /> : null}

      <AppText variant="rowTitle" weight="800" style={styles.heading}>
        {t("balance.activity")}
      </AppText>
      {activity.status === "loading" ? (
        <LoadingState testID="balance-activity-loading" />
      ) : null}
      {activity.status === "error" ? (
        <FailureState
          kind={activity.kind}
          onRetry={() => void loadActivity()}
          testID="balance-activity-error"
        />
      ) : null}
      {activity.status === "loaded" ? (
        activity.items.length === 0 ? (
          <Muted testID="balance-activity-empty">
            {t("balance.activityEmpty")}
          </Muted>
        ) : (
          <View testID="balance-activity">
            {activityEntries(activity.items, t, language).map(
              (entry, index, all) => (
                <ListRow
                  key={entry.key}
                  title={entry.title}
                  subtitle={entry.subtitle}
                  trailing={
                    <AppText
                      variant="body"
                      weight={entry.credit ? "800" : "700"}
                      color={entry.credit ? colors.accent : colors.textSecondary}
                    >
                      {formatSignedMoney(entry.amount, entry.currency, language, {
                        alwaysSign: true,
                      })}
                    </AppText>
                  }
                  last={index === all.length - 1}
                  testID={entry.key}
                />
              ),
            )}
          </View>
        )
      ) : null}

      {showSteps ? <SettleSteps testID="balance-settle-steps" /> : null}
      {main?.status !== "blocked" ? (
        <OutlineButton
          title={t("balance.howToSettle")}
          onPress={() => setShowSteps((previous) => !previous)}
          testID="balance-how-to-settle"
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.text,
    borderRadius: 20,
    padding: spacing.ml,
    gap: 6,
  },
  amount: {
    fontSize: 42,
    lineHeight: 50,
    fontWeight: "800",
    letterSpacing: -1,
  },
  heading: { marginTop: spacing.xs },
});
