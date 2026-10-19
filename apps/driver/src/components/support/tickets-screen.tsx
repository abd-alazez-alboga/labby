import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import { getLostItemCases, getTickets } from "../../api/support";
import type {
  CaseStatus,
  LostItemCase,
  Ticket,
  TicketStatus,
} from "../../api/support-types";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { colors, spacing } from "../../theme/tokens";
import { formatDayMonth } from "../../trust/format";
import {
  AppText,
  FailureState,
  LoadingState,
  Muted,
  PrimaryButton,
  Screen,
  StatusChip,
  TextButton,
  useDirection,
} from "../ui";
import type { Tone } from "../ui";

const PAGE_SIZE = 20;

export const STATUS_TONES: Record<TicketStatus, Tone> = {
  open: "accent",
  in_progress: "accent",
  waiting_on_user: "warning",
  resolved: "success",
  closed: "neutral",
};

export const CASE_TONES: Record<CaseStatus, Tone> = {
  reported: "accent",
  driver_contacted: "accent",
  found: "success",
  not_found: "warning",
  returned: "success",
  closed: "neutral",
};

/** One list entry: a plain ticket, or a lost-item case on one of my rides. */
type Row =
  | { kind: "ticket"; ticket: Ticket }
  | { kind: "case"; lostCase: LostItemCase };

function rowKey(row: Row): string {
  return row.kind === "ticket" ? row.ticket.ticketId : row.lostCase.ticketId;
}

function rowUpdatedAt(row: Row): string {
  return row.kind === "ticket" ? row.ticket.updatedAt : row.lostCase.updatedAt;
}

/**
 * The driver's cases are the RIDER's tickets, so they come from
 * `/lost-items`, not `/tickets` — merged here, newest first, deduped by
 * ticketId (a lost-item ticket of my own would otherwise appear twice).
 */
export function mergeRows(tickets: Ticket[], cases: LostItemCase[]): Row[] {
  const caseIds = new Set(cases.map((item) => item.ticketId));
  const rows: Row[] = [
    ...cases.map((lostCase): Row => ({ kind: "case", lostCase })),
    ...tickets
      .filter((ticket) => !caseIds.has(ticket.ticketId))
      .map((ticket): Row => ({ kind: "ticket", ticket })),
  ];
  return rows.sort(
    (a, b) => Date.parse(rowUpdatedAt(b)) - Date.parse(rowUpdatedAt(a)),
  );
}

type Load =
  | { status: "loading" }
  | {
      status: "loaded";
      /** Every /tickets page loaded so far, deduped by ticketId. */
      tickets: Ticket[];
      /** Cases are small and come in one page (with page 0). */
      cases: LostItemCase[];
      page: number;
      totalTickets: number;
      /** An older /tickets page is in flight ("show older" is busy). */
      loadingMore: boolean;
      /** The last older page failed — inline retry under the list. */
      moreError: boolean;
    }
  | { status: "error"; kind: FailureKind };

function TicketRow({ row, last }: { row: Row; last: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language, flipRows } = useDirection();

  const id = rowKey(row);
  const title =
    row.kind === "case"
      ? `${t("support.tickets.lostItem")} · ${row.lostCase.description}`
      : row.ticket.description;
  const chip =
    row.kind === "case"
      ? {
          label: t(`support.caseStatus.${row.lostCase.caseStatus}`),
          tone: CASE_TONES[row.lostCase.caseStatus],
        }
      : {
          label: t(`support.status.${row.ticket.status}`),
          tone: STATUS_TONES[row.ticket.status],
        };
  const meta = t("support.tickets.meta", {
    category:
      row.kind === "case"
        ? t("support.tickets.lostItem")
        : row.ticket.category.name[language === "ar" ? "ar" : "en"],
    date: formatDayMonth(rowUpdatedAt(row), language),
  });
  const unread = row.kind === "ticket" ? row.ticket.unreadSupportMessages : 0;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push(
          row.kind === "case"
            ? { pathname: "/lost-item-case", params: { ticketId: id } }
            : { pathname: "/ticket", params: { ticketId: id } },
        )
      }
      style={[styles.row, !last && styles.divider]}
      testID={`ticket-row-${id}`}
    >
      <View style={[styles.titleRow, flipRows && styles.rowReverse]}>
        <AppText variant="bodyStrong" weight="800" numberOfLines={1} style={styles.grow}>
          {title}
        </AppText>
        {unread > 0 ? (
          <View style={styles.badge} testID={`ticket-unread-${id}`}>
            <AppText variant="caption" weight="800" color={colors.onAccent}>
              {unread}
            </AppText>
          </View>
        ) : null}
      </View>
      <View style={[styles.metaRow, flipRows && styles.rowReverse]}>
        <StatusChip label={chip.label} tone={chip.tone} testID={`ticket-chip-${id}`} />
        <AppText variant="caption" weight="400" color={colors.textMuted}>
          {meta}
        </AppText>
      </View>
    </Pressable>
  );
}

/**
 * UC-S-20 (board S14Tickets): every ticket of mine plus the lost-item cases
 * on my rides, most recently updated first; status chips per TicketStatus /
 * CaseStatus, unread badges, "show older" paging on the ticket half; a case
 * row opens the case screen, a ticket row its thread.
 */
export function TicketsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchFirst = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const [ticketPage, casePage] = await Promise.all([
        getTickets(0, PAGE_SIZE),
        getLostItemCases({ page: 0, size: 50 }),
      ]);
      if (!mounted.current) return;
      setLoad({
        status: "loaded",
        tickets: ticketPage.items,
        cases: casePage.items,
        page: ticketPage.page,
        totalTickets: ticketPage.totalItems,
        loadingMore: false,
        moreError: false,
      });
    } catch (caught) {
      if (mounted.current) setLoad({ status: "error", kind: failureKindOf(caught) });
    }
  }, []);

  // One older page at a time: the ref closes the gap before the busy
  // state renders, so a double tap never fires two requests.
  const loadingMore = useRef(false);
  const fetchMore = useCallback(async (page: number) => {
    if (loadingMore.current) return;
    loadingMore.current = true;
    setLoad((previous) =>
      previous.status === "loaded"
        ? { ...previous, loadingMore: true, moreError: false }
        : previous,
    );
    try {
      const ticketPage = await getTickets(page, PAGE_SIZE);
      if (!mounted.current) return;
      setLoad((previous) => {
        if (previous.status !== "loaded") return previous;
        const known = new Set(previous.tickets.map((ticket) => ticket.ticketId));
        return {
          ...previous,
          tickets: [
            ...previous.tickets,
            ...ticketPage.items.filter((ticket) => !known.has(ticket.ticketId)),
          ],
          page: ticketPage.page,
          totalTickets: ticketPage.totalItems,
          loadingMore: false,
        };
      });
    } catch {
      if (!mounted.current) return;
      setLoad((previous) =>
        previous.status === "loaded"
          ? { ...previous, loadingMore: false, moreError: true }
          : previous,
      );
    } finally {
      loadingMore.current = false;
    }
  }, []);

  useEffect(() => {
    void fetchFirst();
  }, [fetchFirst]);

  // Rebuilt from everything loaded after every page, so the merged order
  // (most recently updated first) holds across pages.
  const rows = useMemo(
    () => (load.status === "loaded" ? mergeRows(load.tickets, load.cases) : []),
    [load],
  );

  return (
    <Screen
      title={t("support.tickets.title")}
      testID="tickets-screen"
      footer={
        <PrimaryButton
          title={t("support.createTicket")}
          onPress={() => router.push("/ticket-create")}
          testID="tickets-create"
        />
      }
    >
      {load.status === "loading" ? <LoadingState testID="tickets-loading" /> : null}
      {load.status === "error" ? (
        <FailureState
          kind={load.kind}
          onRetry={() => void fetchFirst()}
          testID="tickets-error"
        />
      ) : null}
      {load.status === "loaded" ? (
        rows.length === 0 ? (
          <Muted testID="tickets-empty">{t("support.tickets.empty")}</Muted>
        ) : (
          <View testID="tickets-list">
            {rows.map((row, index) => (
              <TicketRow key={rowKey(row)} row={row} last={index === rows.length - 1} />
            ))}
            {load.moreError ? (
              <View style={styles.moreError} testID="tickets-more-error">
                <AppText variant="secondary" color={colors.textMuted} align="center">
                  {t("support.tickets.loadMoreFailed")}
                </AppText>
                <TextButton
                  title={t("support.tickets.retry")}
                  onPress={() => void fetchMore(load.page + 1)}
                  testID="tickets-more-retry"
                />
              </View>
            ) : load.tickets.length < load.totalTickets ? (
              <TextButton
                title={t("support.tickets.loadMore")}
                busy={load.loadingMore}
                onPress={() => void fetchMore(load.page + 1)}
                testID="tickets-load-more"
              />
            ) : null}
          </View>
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.md, gap: 6 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowReverse: { flexDirection: "row-reverse" },
  grow: { flex: 1 },
  moreError: { paddingTop: spacing.md, gap: spacing.sm },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
