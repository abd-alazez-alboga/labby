/**
 * Report sent · Your reports (UC-S-18, REP-02) — approved artboard
 * RiderReports: after a report is sent, the "Report sent" box on top; then
 * the rider's reports, newest first (`GET /reports/mine?as=rider`), each
 * with its category, when it was sent / reviewed and the OUTCOME label
 * only — "In review" (open), "Action taken" (substantiated), "Not
 * confirmed" (unsubstantiated) — never the internal words or notes; and
 * the footnote on what "Action taken" means.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import { listMyReports, type OwnReport, type ReportStatus } from "../../api/trust";
import {
  AppText,
  EmptyView,
  ErrorView,
  LoadingView,
  StatusChip,
  TextButton,
  useDirection,
  useInsetContentStyle,
  type ChipTone,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { formatDate } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

const STATUS_TONE: Record<ReportStatus, ChipTone> = {
  open: "neutral",
  substantiated: "success",
  unsubstantiated: "neutral",
};

function SentBox() {
  const { t } = useLocale();
  const { row } = useDirection();
  return (
    <View style={[styles.sent, { flexDirection: row }]} testID="reports-sent">
      <View style={styles.sentIcon}>
        <Ionicons name="checkmark" size={20} color={colors.onAccent} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" weight={800}>
          {t("reports.sentTitle")}
        </AppText>
        <AppText variant="caption" tone="secondary" weight={400}>
          {t("reports.sentBody")}
        </AppText>
      </View>
    </View>
  );
}

function ReportRow({ item, last }: { item: OwnReport; last: boolean }) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const sent = formatDate(item.createdAt, locale);
  const line = item.resolvedAt
    ? t("reports.reviewedLine", {
        sent,
        reviewed: formatDate(item.resolvedAt, locale),
      })
    : t("reports.sentLine", { date: sent });
  return (
    <View
      style={[styles.row, { flexDirection: row }, !last && styles.rowLine]}
      testID={`report-${item.id}`}
    >
      <View style={styles.flex}>
        <AppText variant="bodyStrong" weight={800}>
          {t(`report.categories.${item.category}`)}
        </AppText>
        <AppText variant="caption" tone="muted" weight={400}>
          {line}
        </AppText>
      </View>
      <StatusChip
        tone={STATUS_TONE[item.status]}
        label={t(`reports.status.${item.status}`)}
        testID={`report-status-${item.id}`}
      />
    </View>
  );
}

export default function ReportsScreen({ justSent = false }: { justSent?: boolean }) {
  const { t } = useLocale();
  const [items, setItems] = useState<OwnReport[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [failure, setFailure] = useState<FailureKind>("network");
  const [loadingMore, setLoadingMore] = useState(false);
  const contentStyle = useInsetContentStyle(styles.content);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const first = await listMyReports(0);
      setItems(first.items);
      setTotal(first.totalElements);
      setPage(0);
      setStatus("ready");
    } catch (error) {
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await listMyReports(page + 1);
      setItems((list) => [...list, ...next.items]);
      setTotal(next.totalElements);
      setPage(page + 1);
    } catch {
      // the button stays for another try
    } finally {
      setLoadingMore(false);
    }
  };

  if (status === "loading") return <LoadingView testID="reports-loading" />;
  if (status === "error") {
    return <ErrorView kind={failure} onRetry={() => void load()} />;
  }
  if (items.length === 0 && !justSent) {
    return (
      <EmptyView
        icon="flag-outline"
        title={t("reports.emptyTitle")}
        body={t("reports.emptyBody")}
        testID="reports-empty"
      />
    );
  }
  return (
    <FlatList
      style={styles.page}
      contentContainerStyle={contentStyle}
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <ReportRow item={item} last={index === items.length - 1} />
      )}
      testID="reports-list"
      ListHeaderComponent={justSent ? <SentBox /> : null}
      ListFooterComponent={
        <View style={styles.footer}>
          {items.length < total ? (
            <TextButton
              label={t("reports.loadMore")}
              onPress={() => void loadMore()}
              loading={loadingMore}
              testID="reports-load-more"
            />
          ) : null}
          <AppText variant="caption" tone="muted" weight={400} style={styles.note}>
            {t("reports.footnote")}
          </AppText>
        </View>
      }
    />
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
    paddingBottom: spacing.xxl,
  },
  flex: {
    flex: 1,
    gap: 2,
  },
  sent: {
    gap: spacing.md,
    alignItems: "center",
    backgroundColor: colors.accentTint,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  sentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 68,
    paddingVertical: spacing.sm,
  },
  rowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  note: {
    lineHeight: 20,
  },
});
