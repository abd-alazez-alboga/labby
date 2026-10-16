import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { getMyReports } from "../../api/trust";
import type { OwnReport, ReportStatus } from "../../api/trust-types";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { colors, radius, spacing } from "../../theme/tokens";
import { formatDayMonth, formatDayMonthTime } from "../../trust/format";
import {
  AppText,
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
import type { Tone } from "../ui";

const PAGE_SIZE = 20;

/**
 * Reporter outcome labels (owner decision): "In review" / "Action taken" /
 * "Not confirmed" — never the internal outcome names, never notes.
 */
const STATUS_TONES: Record<ReportStatus, Tone> = {
  open: "neutral",
  substantiated: "success",
  unsubstantiated: "neutral",
};

type Load =
  | { status: "loading" }
  | { status: "loaded"; items: OwnReport[]; page: number; total: number }
  | { status: "error"; kind: FailureKind };

function ReportRow({ report, last }: { report: OwnReport; last: boolean }) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const subtitle = report.resolvedAt
    ? t("trust.reports.reviewedAt", {
        sent: formatDayMonth(report.createdAt, language),
        reviewed: formatDayMonth(report.resolvedAt, language),
      })
    : t("trust.reports.sentAt", {
        date: formatDayMonthTime(report.createdAt, language),
      });
  return (
    <ListRow
      title={t(`trust.report.categories.${report.category}`)}
      subtitle={subtitle}
      trailing={
        <StatusChip
          label={t(`trust.reports.status.${report.status}`)}
          tone={STATUS_TONES[report.status]}
          testID={`report-status-${report.id}`}
        />
      }
      last={last}
      testID={`report-row-${report.id}`}
    />
  );
}

/**
 * UC-S-18 outcome view (artboard "Rider Reports" pattern, driver side):
 * "Report sent" right after filing, then the driver's reports newest first
 * (`GET /reports/mine?as=driver`) with the outcome label only.
 */
export function ReportsScreen({ justSent }: { justSent: boolean }) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchPage = useCallback(async (page: number) => {
    if (page === 0) setLoad({ status: "loading" });
    try {
      const result = await getMyReports(page, PAGE_SIZE);
      if (!mounted.current) return;
      setLoad((previous) => ({
        status: "loaded",
        items:
          page > 0 && previous.status === "loaded"
            ? [...previous.items, ...result.items]
            : result.items,
        page: result.page,
        total: result.totalElements,
      }));
    } catch (caught) {
      if (mounted.current) setLoad({ status: "error", kind: failureKindOf(caught) });
    }
  }, []);

  useEffect(() => {
    void fetchPage(0);
  }, [fetchPage]);

  return (
    <Screen testID="reports-screen">
      {justSent ? (
        <View style={[styles.sent, flipRows && styles.rowReverse]} testID="reports-sent">
          <View style={styles.sentIcon}>
            <Icon name="checkmark" size={20} color={colors.onAccent} />
          </View>
          <View style={styles.grow}>
            <AppText variant="bodyStrong" weight="800">
              {t("trust.reports.sentTitle")}
            </AppText>
            <AppText variant="caption" weight="400" color={colors.textSecondary}>
              {t("trust.reports.sentBody")}
            </AppText>
          </View>
        </View>
      ) : null}

      <AppText variant="title" accessibilityRole="header" testID="reports-title">
        {t("trust.reports.title")}
      </AppText>

      {load.status === "loading" ? <LoadingState testID="reports-loading" /> : null}
      {load.status === "error" ? (
        <FailureState
          kind={load.kind}
          onRetry={() => void fetchPage(0)}
          testID="reports-error"
        />
      ) : null}
      {load.status === "loaded" ? (
        load.items.length === 0 ? (
          <Muted testID="reports-empty">{t("trust.reports.empty")}</Muted>
        ) : (
          <View testID="reports-list">
            {load.items.map((report, index) => (
              <ReportRow
                key={report.id}
                report={report}
                last={index === load.items.length - 1}
              />
            ))}
            {load.items.length < load.total ? (
              <TextButton
                title={t("trust.reports.loadMore")}
                onPress={() => void fetchPage(load.page + 1)}
                testID="reports-load-more"
              />
            ) : null}
          </View>
        )
      ) : null}

      <AppText variant="caption" weight="400" color={colors.textMuted}>
        {t("trust.reports.footnote")}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    backgroundColor: colors.accentTint,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  rowReverse: { flexDirection: "row-reverse" },
  sentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1, gap: 2 },
});
