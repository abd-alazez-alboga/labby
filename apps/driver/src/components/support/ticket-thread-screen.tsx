import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, StyleSheet, TextInput, View } from "react-native";

import { ApiError } from "../../api/client";
import { getTicket, postTicketMessage, supportErrorCode } from "../../api/support";
import type {
  TicketDetail,
  TicketEvent,
  TicketMessage,
} from "../../api/support-types";
import { TICKET_MESSAGE_MAX } from "../../api/support-types";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { colors, radius, spacing } from "../../theme/tokens";
import { formatCount, formatDayMonthTime } from "../../trust/format";
import {
  AppText,
  Banner,
  FailureState,
  FieldError,
  Icon,
  LoadingState,
  Muted,
  Screen,
  SquareIconButton,
  StatusChip,
  useDirection,
} from "../ui";
import { STATUS_TONES } from "./tickets-screen";

type Load =
  | { status: "loading" }
  | { status: "loaded"; ticket: TicketDetail }
  | { status: "gone" }
  | { status: "error"; kind: FailureKind };

/** The thread interleaves messages and the user-visible events by time. */
type Entry =
  | { kind: "message"; message: TicketMessage }
  | { kind: "event"; event: TicketEvent };

function entryTime(entry: Entry): number {
  return Date.parse(
    entry.kind === "message" ? entry.message.createdAt : entry.event.createdAt,
  );
}

/** Internal bookkeeping (priority, assignment) never shows to the user. */
const SHOWN_EVENTS = new Set(["status_changed", "case_status_changed", "reminder_sent"]);

export function threadEntries(ticket: TicketDetail): Entry[] {
  const entries: Entry[] = [
    ...ticket.messages.map((message): Entry => ({ kind: "message", message })),
    ...ticket.events
      .filter((event) => SHOWN_EVENTS.has(event.type))
      .map((event): Entry => ({ kind: "event", event })),
  ];
  return entries.sort((a, b) => entryTime(a) - entryTime(b));
}

function EventMarker({ event }: { event: TicketEvent }) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const date = formatDayMonthTime(event.createdAt, language);
  let text: string;
  if (event.type === "reminder_sent") {
    text = t("support.thread.eventReminder", { date });
  } else if (event.type === "case_status_changed") {
    text = t("support.thread.eventCase", {
      status: event.toValue ? t(`support.caseStatus.${event.toValue}`) : "",
      date,
    });
  } else {
    text = t("support.thread.eventStatus", {
      status: event.toValue ? t(`support.status.${event.toValue}`) : "",
      date,
    });
  }
  return (
    <View style={styles.marker} testID={`thread-event-${event.eventId}`}>
      <AppText variant="caption" weight="700" color={colors.textMuted}>
        {text}
      </AppText>
    </View>
  );
}

function MessageBubble({ message }: { message: TicketMessage }) {
  const { language } = useDirection();
  const mine = message.senderSide === "user";
  return (
    <View
      style={[styles.bubble, mine ? styles.mine : styles.theirs]}
      testID={`thread-message-${message.messageId}`}
    >
      {!mine ? (
        <AppText variant="caption" weight="800" color={colors.accent}>
          {message.senderName}
        </AppText>
      ) : null}
      <AppText
        variant="body"
        color={mine ? colors.onAccent : colors.text}
      >
        {message.body}
      </AppText>
      <AppText
        variant="caption"
        weight="400"
        color={mine ? colors.accentTint : colors.textMuted}
        style={styles.time}
      >
        {formatDayMonthTime(message.createdAt, language)}
      </AppText>
    </View>
  );
}

/**
 * UC-S-20 (boards S14TicketThread / S14TicketThreadAr): the ticket's thread
 * — messages and status events oldest first, the `waiting_on_user` banner,
 * attachments under the opening description, and the composer. A reply on
 * `waiting_on_user` / `resolved` reopens the discussion (the server moves it
 * back to `in_progress`); `closed` is read-only and a racing 409
 * `ticket_closed` flips the screen to that state.
 */
export function TicketThreadScreen({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<"failed" | "closed" | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchTicket = useCallback(async () => {
    try {
      const ticket = await getTicket(ticketId);
      if (mounted.current) setLoad({ status: "loaded", ticket });
    } catch (caught) {
      if (!mounted.current) return;
      if (caught instanceof ApiError && caught.status === 404) {
        setLoad({ status: "gone" });
      } else {
        setLoad({ status: "error", kind: failureKindOf(caught) });
      }
    }
  }, [ticketId]);

  useEffect(() => {
    void fetchTicket();
  }, [fetchTicket]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || load.status !== "loaded") return;
    setSending(true);
    setSendError(null);
    try {
      await postTicketMessage(ticketId, body);
      setDraft("");
      // Re-read: the reply may have moved the status back to in_progress.
      await fetchTicket();
    } catch (caught) {
      if (supportErrorCode(caught) === "ticket_closed") {
        setSendError("closed");
        await fetchTicket();
      } else {
        setSendError("failed");
      }
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  const ticket = load.status === "loaded" ? load.ticket : null;
  const closed = ticket?.status === "closed";

  return (
    <Screen
      testID="ticket-thread-screen"
      keyboardShouldPersistTaps="handled"
      footer={
        ticket ? (
          closed ? (
            <Muted testID="thread-closed-notice">
              {t("support.thread.closedNotice")}
            </Muted>
          ) : (
            <>
              <View style={[styles.composer, flipRows && styles.rowReverse]}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={t("support.thread.placeholder")}
                  placeholderTextColor={colors.textMuted}
                  maxLength={TICKET_MESSAGE_MAX}
                  multiline
                  accessibilityLabel={t("support.thread.placeholder")}
                  style={[styles.input, flipRows && styles.inputRtl]}
                  testID="thread-input"
                />
                <SquareIconButton
                  icon="send"
                  accessibilityLabel={t("support.thread.send")}
                  onPress={() => void send()}
                  disabled={draft.trim().length === 0 || sending}
                  testID="thread-send"
                />
              </View>
              {sendError ? (
                <FieldError testID="thread-send-error">
                  {t(
                    sendError === "closed"
                      ? "support.thread.closedRefused"
                      : "support.thread.sendFailed",
                  )}
                </FieldError>
              ) : null}
            </>
          )
        ) : undefined
      }
    >
      {load.status === "loading" ? <LoadingState testID="thread-loading" /> : null}
      {load.status === "error" ? (
        <FailureState
          kind={load.kind}
          onRetry={() => void fetchTicket()}
          testID="thread-error"
        />
      ) : null}
      {load.status === "gone" ? (
        <Muted testID="thread-gone">{t("support.thread.notFound")}</Muted>
      ) : null}

      {ticket ? (
        <>
          <View style={styles.head}>
            <AppText variant="heading" numberOfLines={2} testID="thread-title">
              {ticket.description}
            </AppText>
            <View style={[styles.metaRow, flipRows && styles.rowReverse]}>
              <StatusChip
                label={t(`support.status.${ticket.status}`)}
                tone={STATUS_TONES[ticket.status]}
                testID="thread-status"
              />
              <AppText variant="caption" weight="400" color={colors.textMuted}>
                {t("support.thread.meta", {
                  category: ticket.category.name[language === "ar" ? "ar" : "en"],
                  date: formatDayMonthTime(ticket.createdAt, language),
                })}
              </AppText>
            </View>
          </View>

          <View style={styles.marker}>
            <AppText variant="caption" weight="700" color={colors.textMuted}>
              {t("support.thread.opened", {
                date: formatDayMonthTime(ticket.createdAt, language),
              })}
            </AppText>
          </View>

          {ticket.attachments.length > 0 ? (
            <View
              style={[styles.attachments, flipRows && styles.rowReverse]}
              testID="thread-attachments"
            >
              {ticket.attachments.map((attachment, index) =>
                attachment.contentType === "application/pdf" ? (
                  <View
                    key={attachment.fileId}
                    style={[styles.attachment, styles.pdf]}
                    accessibilityLabel={t("support.thread.attachment", {
                      n: formatCount(index + 1, language),
                    })}
                    testID={`thread-attachment-${index}`}
                  >
                    <Icon
                      name="document-text-outline"
                      size={20}
                      color={colors.textMuted}
                    />
                  </View>
                ) : (
                  <Image
                    key={attachment.fileId}
                    source={{ uri: attachment.url }}
                    style={styles.attachment}
                    accessibilityLabel={t("support.thread.attachment", {
                      n: formatCount(index + 1, language),
                    })}
                    testID={`thread-attachment-${index}`}
                  />
                ),
              )}
            </View>
          ) : null}

          {threadEntries(ticket).map((entry) =>
            entry.kind === "message" ? (
              <MessageBubble key={entry.message.messageId} message={entry.message} />
            ) : (
              <EventMarker key={entry.event.eventId} event={entry.event} />
            ),
          )}

          {ticket.status === "waiting_on_user" ? (
            <Banner
              tone="warning"
              message={t("support.thread.waitingBanner")}
              testID="thread-waiting-banner"
            />
          ) : null}
          {ticket.status === "resolved" ? (
            <Muted testID="thread-resolved-hint">
              {t("support.thread.resolvedHint")}
            </Muted>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.sm },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  rowReverse: { flexDirection: "row-reverse" },
  marker: { alignSelf: "center", paddingVertical: spacing.xs },
  bubble: {
    maxWidth: "82%",
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: spacing.xs,
  },
  mine: {
    alignSelf: "flex-end",
    backgroundColor: colors.accent,
  },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  time: { alignSelf: "flex-end" },
  attachments: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  attachment: {
    width: 88,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
  },
  pdf: { alignItems: "center", justifyContent: "center" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 24,
    backgroundColor: colors.surfaceFill,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    textAlign: "left",
  },
  inputRtl: { textAlign: "right" },
});
