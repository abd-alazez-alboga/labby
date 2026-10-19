/**
 * Your tickets (UC-S-20) — approved artboard S14Tickets: every ticket
 * (both kinds), most recently updated first, with the status chip, the
 * unread-support-replies badge and the last update date. A lost-item
 * ticket opens its case screen; a plain one opens the thread.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";

import { failureKind, type FailureKind } from "../../api/http-client";
import {
  listMyTickets,
  localized,
  type Ticket,
  type TicketStatus,
} from "../../api/support";
import {
  AppText,
  EmptyView,
  ErrorView,
  LoadingView,
  PrimaryButton,
  StatusChip,
  TextButton,
  useDirection,
  useInsetContentStyle,
  type ChipTone,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { UnreadBadge } from "../../notifications/unread-badge";
import { formatDate } from "../../ride/ride-format";
import { colors, spacing } from "../../theme/tokens";

const STATUS_TONE: Record<TicketStatus, ChipTone> = {
  open: "success",
  in_progress: "accent",
  waiting_on_user: "warning",
  resolved: "success",
  closed: "neutral",
};

function TicketRow({ item, last }: { item: Ticket; last: boolean }) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const closed = item.status === "closed";
  const title =
    item.kind === "lost_item"
      ? `${t("tickets.lostItemTitle")} · ${item.description}`
      : item.description;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push(
          item.kind === "lost_item"
            ? (`/lost-item/${encodeURIComponent(item.ticketId)}` as never)
            : (`/ticket/${encodeURIComponent(item.ticketId)}` as never),
        )
      }
      style={[styles.row, !last && styles.rowLine]}
      testID={`ticket-${item.ticketId}`}
    >
      <View style={[styles.titleRow, { flexDirection: row }]}>
        <AppText
          variant="bodyStrong"
          weight={800}
          tone={closed ? "muted" : "default"}
          numberOfLines={1}
          style={styles.flex}
        >
          {title}
        </AppText>
        <UnreadBadge
          count={item.unreadSupportMessages}
          testID={`ticket-unread-${item.ticketId}`}
        />
      </View>
      <View style={[styles.metaRow, { flexDirection: row }]}>
        <StatusChip
          tone={STATUS_TONE[item.status]}
          label={t(`tickets.status.${item.status}`)}
          testID={`ticket-status-${item.ticketId}`}
        />
        <AppText variant="caption" tone="muted" weight={400}>
          {localized(item.category.name, locale)} ·{" "}
          {t("tickets.updated", { date: formatDate(item.updatedAt, locale) })}
        </AppText>
      </View>
    </Pressable>
  );
}

export default function TicketsScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [failure, setFailure] = useState<FailureKind>("network");
  const [loadingMore, setLoadingMore] = useState(false);
  const contentStyle = useInsetContentStyle(styles.content);

  const load = useCallback(async () => {
    try {
      const first = await listMyTickets(0);
      setItems(first.items);
      setTotal(first.totalItems);
      setPage(0);
      setStatus("ready");
    } catch (error) {
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, []);

  // Refresh on focus so read threads clear their unread badges.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await listMyTickets(page + 1);
      setItems((list) => [...list, ...next.items]);
      setTotal(next.totalItems);
      setPage(page + 1);
    } catch {
      // the button stays for another try
    } finally {
      setLoadingMore(false);
    }
  };

  if (status === "loading") return <LoadingView testID="tickets-loading" />;
  if (status === "error") {
    return (
      <ErrorView
        kind={failure}
        onRetry={() => {
          setStatus("loading");
          void load();
        }}
      />
    );
  }
  if (items.length === 0) {
    return (
      <View style={styles.page}>
        <EmptyView
          icon="chatbubble-ellipses-outline"
          title={t("tickets.emptyTitle")}
          body={t("tickets.emptyBody")}
          testID="tickets-empty"
        />
        <View style={styles.emptyAction}>
          <PrimaryButton
            label={t("support.createTicket")}
            onPress={() => router.push("/new-ticket" as never)}
            testID="tickets-empty-create"
          />
        </View>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.page}
      contentContainerStyle={contentStyle}
      data={items}
      keyExtractor={(item) => item.ticketId}
      renderItem={({ item, index }) => (
        <TicketRow item={item} last={index === items.length - 1} />
      )}
      testID="tickets-list"
      ListFooterComponent={
        <View style={styles.footer}>
          {items.length < total ? (
            <TextButton
              label={t("tickets.loadMore")}
              onPress={() => void loadMore()}
              loading={loadingMore}
              testID="tickets-load-more"
            />
          ) : null}
          <PrimaryButton
            label={t("support.createTicket")}
            onPress={() => router.push("/new-ticket" as never)}
            testID="tickets-create"
          />
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
  row: {
    gap: 6,
    paddingVertical: spacing.lg,
  },
  rowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  titleRow: {
    alignItems: "center",
    gap: spacing.sm,
  },
  metaRow: {
    alignItems: "center",
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  footer: {
    gap: spacing.md,
    paddingTop: spacing.xl,
  },
  emptyAction: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
});
