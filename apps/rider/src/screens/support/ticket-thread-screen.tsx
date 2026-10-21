/**
 * Ticket thread (UC-S-20, SUP-02) — approved artboards S14TicketThread /
 * S14TicketThreadAr: the ticket's messages and history events merged
 * oldest-first, the waiting-on-you / resolved / closed banners, and the
 * composer. A user reply on `waiting_on_user` or `resolved` moves the
 * ticket back to `in_progress` server-side; `closed` is read-only
 * (409 `ticket_closed`). Opening the thread stamps the read marker, so
 * the list's unread badge clears on return. The thread re-reads on focus,
 * on foreground re-entry and when a support push for this ticket arrives
 * while it is open (L-W7), so a support reply shows up without leaving.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { ApiError, failureKind, type FailureKind } from "../../api/http-client";
import {
  getTicket,
  localized,
  postTicketMessage,
  TICKET_MESSAGE_MAX,
  type TicketDetail,
  type TicketEvent,
  type TicketMessage,
  type TicketStatus,
} from "../../api/support";
import {
  AppText,
  Banner,
  ErrorView,
  LoadingView,
  StatusChip,
  TextButton,
  useBottomBarPadding,
  useDirection,
  useFontFamily,
  type ChipTone,
} from "../../components/ui";
import { useFocusRefresh } from "../../hooks/use-focus-refresh";
import { useLocale } from "../../i18n/locale-context";
import { parsePushPayload } from "../../notifications/deep-links";
import { notificationData } from "../../notifications/notifications-context";
import { notifications } from "../../notifications/notifications-module";
import { formatDate, formatDateTime } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

const STATUS_TONE: Record<TicketStatus, ChipTone> = {
  open: "success",
  in_progress: "accent",
  waiting_on_user: "warning",
  resolved: "success",
  closed: "neutral",
};

type ThreadItem =
  | { kind: "message"; at: string; message: TicketMessage }
  | { kind: "event"; at: string; event: TicketEvent };

/** Messages and the user-visible events, merged oldest-first. */
function threadItems(detail: TicketDetail): ThreadItem[] {
  const items: ThreadItem[] = detail.messages.map((message) => ({
    kind: "message",
    at: message.createdAt,
    message,
  }));
  for (const event of detail.events) {
    // Priority / assignment moves are admin bookkeeping; the user-facing
    // history is creation, status changes and reminders.
    if (
      event.type === "created" ||
      event.type === "status_changed" ||
      event.type === "case_status_changed" ||
      event.type === "reminder_sent"
    ) {
      items.push({ kind: "event", at: event.createdAt, event });
    }
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

export default function TicketThreadScreen({ ticketId }: { ticketId: string }) {
  const { t, locale } = useLocale();
  const { row, flipRows } = useDirection();
  const router = useRouter();
  const fontFamily = useFontFamily(400);
  const composerPadding = useBottomBarPadding(spacing.xl);
  // The stack header sits above this screen: the keyboard offset is the
  // page's distance from the window top (the header's measured height).
  const pageRef = useRef<View>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [failure, setFailure] = useState<FailureKind>("network");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await getTicket(ticketId));
      setStatus("ready");
    } catch (error) {
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, [ticketId]);

  // On focus (incl. the first): back from another screen re-reads.
  const loadOnFocus = useCallback(() => {
    void load();
  }, [load]);
  useFocusRefresh(loadOnFocus);

  // Foreground re-entry: a reply may have landed meanwhile.
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") void load();
      previous = next;
    });
    return () => subscription.remove();
  }, [load]);

  // A support push for THIS ticket while the thread is open (support-v1
  // "Notifications": screen `ticket` {ticketId}).
  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = notifications().addNotificationReceivedListener(
        (notification) => {
          const { link } = parsePushPayload(notificationData(notification));
          if (link?.params?.ticketId === ticketId) void load();
        },
      );
    } catch {
      // unsupported runtime (Expo Go) — focus / foreground still refresh
    }
    return () => subscription?.remove();
  }, [ticketId, load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !detail) return;
    setSending(true);
    setSendError(null);
    try {
      await postTicketMessage(ticketId, body);
      setDraft("");
      // Re-read: the reply may have moved the status back to in_progress.
      await load();
    } catch (error) {
      const code =
        error instanceof ApiError ? (error.body?.code ?? null) : null;
      setSendError(
        code === "ticket_closed"
          ? t("ticket.errors.ticket_closed")
          : t("ticket.errors.generic"),
      );
      if (code === "ticket_closed") await load();
    } finally {
      setSending(false);
    }
  };

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
  if (status === "loading" || !detail) {
    return <LoadingView testID="ticket-thread-loading" />;
  }

  const closed = detail.status === "closed";
  const items = threadItems(detail);

  const eventLine = (event: TicketEvent): string => {
    const date = formatDateTime(event.createdAt, locale);
    if (event.type === "created") return t("ticket.openedEvent", { date });
    if (event.type === "reminder_sent")
      return t("ticket.reminderEvent", { date });
    const to = event.toValue;
    const label =
      detail.kind === "lost_item" && event.type === "case_status_changed"
        ? t(`lostItem.status.${to ?? "reported"}`)
        : t(`tickets.status.${(to ?? "open") as TicketStatus}`);
    return t("ticket.statusEvent", { status: label, date });
  };

  // Bubbles hug their screen edge like the M10 chat: the user's on the
  // reading end; `flipRows` mirrors the sides pre-restart in AR.
  const userOnRight = !flipRows;

  return (
    <View
      ref={pageRef}
      style={styles.page}
      onLayout={() =>
        pageRef.current?.measureInWindow((_x, y) => setKeyboardOffset(y))
      }
    >
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={keyboardOffset}
        testID="ticket-thread"
      >
        <View style={styles.header}>
          <AppText variant="heading" numberOfLines={2}>
            {detail.kind === "lost_item"
              ? `${t("tickets.lostItemTitle")} · ${detail.description}`
              : detail.description}
          </AppText>
          <View style={[styles.headerMeta, { flexDirection: row }]}>
            <StatusChip
              tone={STATUS_TONE[detail.status]}
              label={t(`tickets.status.${detail.status}`)}
              testID="ticket-thread-status"
            />
            <AppText variant="caption" tone="muted" weight={400}>
              {t("ticket.openedLine", {
                category: localized(detail.category.name, locale),
                date: formatDate(detail.createdAt, locale),
              })}
            </AppText>
          </View>
          {detail.kind === "lost_item" ? (
            <TextButton
              label={t("ticket.viewCase")}
              onPress={() =>
                router.push(
                  `/lost-item/${encodeURIComponent(detail.ticketId)}` as never,
                )
              }
              testID="ticket-thread-case"
            />
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: false })
          }
          testID="ticket-thread-scroll"
        >
          {items.map((item) =>
            item.kind === "event" ? (
              <View
                key={item.event.eventId}
                style={styles.event}
                testID={`ticket-event-${item.event.eventId}`}
              >
                <AppText variant="caption" tone="muted" align="center">
                  {eventLine(item.event)}
                </AppText>
              </View>
            ) : (
              <View
                key={item.message.messageId}
                style={[
                  styles.bubble,
                  item.message.senderSide === "user"
                    ? styles.bubbleUser
                    : styles.bubbleSupport,
                  {
                    alignSelf:
                      (item.message.senderSide === "user") === userOnRight
                        ? "flex-end"
                        : "flex-start",
                  },
                ]}
                testID={`ticket-message-${item.message.messageId}`}
              >
                {item.message.senderSide === "support" ? (
                  <AppText variant="caption" weight={800} tone="accent">
                    {t("ticket.supportName")}
                  </AppText>
                ) : null}
                <AppText
                  variant="secondary"
                  weight={400}
                  tone={
                    item.message.senderSide === "user" ? "onAccent" : "default"
                  }
                  style={styles.bubbleText}
                >
                  {item.message.body}
                </AppText>
              </View>
            ),
          )}
          {detail.status === "waiting_on_user" ? (
            <Banner
              tone="warning"
              message={t("ticket.waitingBanner", {
                date: formatDateTime(detail.updatedAt, locale),
              })}
              testID="ticket-waiting-banner"
            />
          ) : null}
          {detail.status === "resolved" ? (
            <Banner
              tone="success"
              message={t("ticket.resolvedBanner")}
              testID="ticket-resolved-banner"
            />
          ) : null}
          {closed ? (
            <Banner
              tone="neutral"
              message={t("ticket.closedBanner")}
              testID="ticket-closed-banner"
            />
          ) : null}
          {sendError ? (
            <Banner tone="danger" message={sendError} testID="ticket-send-error" />
          ) : null}
        </ScrollView>

        {!closed ? (
          <View
            style={[
              styles.composer,
              { flexDirection: row, paddingBottom: composerPadding },
            ]}
          >
            <TextInput
              style={[styles.input, { fontFamily }]}
              value={draft}
              onChangeText={setDraft}
              placeholder={t("ticket.composerPlaceholder")}
              placeholderTextColor={colors.textMuted}
              maxLength={TICKET_MESSAGE_MAX}
              multiline
              accessibilityLabel={t("ticket.composerPlaceholder")}
              testID="ticket-composer"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("ticket.send")}
              onPress={() => void send()}
              disabled={sending || !draft.trim()}
              style={[
                styles.send,
                (sending || !draft.trim()) && styles.sendDisabled,
              ]}
              testID="ticket-send-button"
            >
              <Ionicons name="send" size={18} color={colors.onAccent} />
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerMeta: {
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  thread: {
    flex: 1,
    backgroundColor: colors.surfacePage,
  },
  threadContent: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  event: {
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    gap: 2,
  },
  bubbleUser: {
    backgroundColor: colors.accent,
  },
  bubbleSupport: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  bubbleText: {
    lineHeight: 21,
  },
  composer: {
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: radius.sheet,
    backgroundColor: colors.surfaceFill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: radius.round,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: {
    opacity: 0.4,
  },
});
