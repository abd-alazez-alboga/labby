/**
 * Wallet (UC-R-17, PAY-01) — approved artboards RiderWallet / RiderWalletAr:
 * the purple balance card per currency (credits come from refunds/promos/
 * rewards — no top-ups), an amber banner per pending due ("will be added to
 * your next ride", owner ruling 2026-10-11), and the typed activity list
 * (newest first, signed currency-formatted amounts, paged). Arabic renders
 * WESTERN digits with amounts in an LTR isolate and the "ل.س" label.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import {
  getWallet,
  listWalletTransactions,
  type WalletTransaction,
  type WalletTransactionType,
  type WalletView,
} from "../../api/wallet";
import {
  AppText,
  Banner,
  ErrorView,
  LoadingView,
  ScreenScrollView,
  screenStyles,
  TextButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { useOptionalRegion } from "../../region/region-context";
import {
  formatDate,
  formatMoney,
  formatSignedMoney,
} from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

const TYPE_ICON: Record<
  WalletTransactionType,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  fare_payment: "car-outline",
  tip: "heart-outline",
  cancellation_fee: "close-outline",
  refund: "refresh-outline",
  admin_grant: "wallet-outline",
  referral: "people-outline",
  promo: "gift-outline",
  loyalty_redemption: "star-outline",
};

function ActivityRow({
  item,
  last,
}: {
  item: WalletTransaction;
  last: boolean;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const credit = item.amount >= 0;
  const subtitleParts = [
    formatDate(item.createdAt, locale),
    item.reason?.trim()
      ? item.reason.trim()
      : item.type === "cancellation_fee"
        ? t("wallet.takenFromWallet")
        : null,
  ].filter(Boolean);
  return (
    <View
      style={[styles.activityRow, { flexDirection: row }, !last && styles.rowDivider]}
      testID={`wallet-tx-${item.id}`}
    >
      <View style={[styles.txWell, credit && styles.txWellCredit]}>
        <Ionicons
          name={TYPE_ICON[item.type]}
          size={16}
          color={credit ? colors.accent : colors.text}
        />
      </View>
      <View style={styles.txText}>
        <AppText variant="bodyStrong" weight={700}>
          {t(`wallet.types.${item.type}`)}
        </AppText>
        <AppText variant="caption" tone="muted" weight={400}>
          {subtitleParts.join(" · ")}
        </AppText>
      </View>
      <AppText
        variant="bodyStrong"
        weight={credit ? 800 : 700}
        tone={credit ? "default" : "secondary"}
        testID={`wallet-tx-amount-${item.id}`}
      >
        {formatSignedMoney(item.amount, item.currency, locale, t)}
      </AppText>
    </View>
  );
}

export default function WalletScreen() {
  const { t, locale } = useLocale();
  const region = useOptionalRegion();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [items, setItems] = useState<WalletTransaction[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(0);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const [view, first] = await Promise.all([
        getWallet(),
        listWalletTransactions(0),
      ]);
      setWallet(view);
      setItems(first.items);
      setTotalItems(first.totalItems);
      setPage(0);
    } catch (error) {
      setFailure(failureKind(error));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const next = await listWalletTransactions(page + 1);
      setItems((list) => [...list, ...next.items]);
      setTotalItems(next.totalItems);
      setPage(page + 1);
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  if (failure) return <ErrorView kind={failure} onRetry={() => void load()} />;
  if (!wallet) return <LoadingView testID="wallet-loading" />;

  // At least one card: the region's currency at 0 when nothing was credited.
  const balances = wallet.balances.length
    ? wallet.balances
    : [{ currency: region?.config?.currency ?? "SYP", balance: 0 }];

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="wallet-screen"
    >
      {balances.map((entry) => (
        <View key={entry.currency} style={styles.balanceCard}>
          <AppText
            variant="label"
            weight={700}
            style={styles.balanceLabel}
          >
            {t("wallet.balanceLabel", {
              currency: t(`money.currencyNames.${entry.currency}`, {
                defaultValue: entry.currency,
              }),
            })}
          </AppText>
          <AppText
            weight={800}
            style={styles.balanceAmount}
            testID={`wallet-balance-${entry.currency}`}
          >
            {formatMoney(entry.balance, entry.currency, locale, t)}
          </AppText>
          <AppText variant="caption" weight={400} style={styles.balanceNote}>
            {t("wallet.noTopUps")}
          </AppText>
        </View>
      ))}

      {wallet.dues.map((due) => (
        <Banner
          key={due.id}
          tone="warning"
          message={t("wallet.dueBanner", {
            money: formatMoney(due.amount, due.currency, locale, t),
            date: formatDate(due.createdAt, locale),
          })}
          testID={`wallet-due-${due.id}`}
        />
      ))}

      <AppText variant="heading">{t("wallet.activity")}</AppText>
      {items.length === 0 ? (
        <View style={styles.empty} testID="wallet-empty">
          <AppText variant="bodyStrong" weight={700}>
            {t("wallet.emptyTitle")}
          </AppText>
          <AppText variant="secondary" tone="muted">
            {t("wallet.emptyBody")}
          </AppText>
        </View>
      ) : (
        <View>
          {items.map((item, index) => (
            <ActivityRow
              key={item.id}
              item={item}
              last={index === items.length - 1}
            />
          ))}
          {loadMoreFailed ? (
            <AppText variant="secondary" tone="danger" testID="wallet-load-more-failed">
              {t("wallet.loadMoreFailed")}
            </AppText>
          ) : null}
          {items.length < totalItems ? (
            <TextButton
              label={t("wallet.loadMore")}
              onPress={() => void loadMore()}
              loading={loadingMore}
              testID="wallet-load-more"
            />
          ) : null}
        </View>
      )}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  balanceCard: {
    backgroundColor: colors.accent,
    // Artboard: 20 px card radius (between radius.lg and radius.sheet).
    borderRadius: 20,
    padding: spacing.xl,
    gap: 6,
  },
  balanceLabel: {
    color: "#DCCAEC",
  },
  balanceAmount: {
    fontSize: 40,
    color: colors.onAccent,
  },
  balanceNote: {
    color: "#DCCAEC",
  },
  activityRow: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  txWell: {
    width: 36,
    height: 36,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  txWellCredit: {
    backgroundColor: colors.accentTint,
  },
  txText: {
    flex: 1,
    gap: 1,
  },
  empty: {
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
});
