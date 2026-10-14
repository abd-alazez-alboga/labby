/**
 * In-ride chat (UC-S-13/14, CHAT-01/02) — approved artboards RiderChat /
 * RiderChatAr: thread header (driver initial/photo, name, vehicle · state,
 * round call button), message bubbles with times, the "Seen" marker, the
 * localized quick-reply chips and the message input + round send button.
 *
 * Window states: `open`/`reopened` = full UI; `read_only` = history only,
 * the composer and the call button are replaced by a short notice; a 404
 * thread shows the no-chat state. The call button renders only while
 * `counterpart.phone` is non-null (CALL-01 window gating).
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ChatMessage, ChatThread, QuickReply } from "../../api/comms";
import {
  AppText,
  Banner,
  EmptyView,
  LoadingView,
  TextButton,
  useDirection,
  useFontFamily,
} from "../../components/ui";
import { useChatThread } from "../../chat/use-chat-thread";
import type { PendingMessage } from "../../chat/use-chat-thread";
import { useLocale } from "../../i18n/locale-context";
import type { AppLocale } from "../../i18n/translations";
import { useOptionalActiveRide } from "../../ride/ride-context";
import { formatClock, formatDate } from "../../ride/ride-format";
import { colors, radius, spacing, touchTarget } from "../../theme/tokens";

// Artboard-specific surfaces (RiderChat): the thread ground and bubbles.
const THREAD_GROUND = "#FBFAFC";
const BUBBLE_BORDER = "#ECEAF0";
const MINE_TIME = "#D9C7EA";

function quickReplyText(reply: QuickReply, locale: AppLocale): string {
  return locale === "ar" ? reply.textAr : reply.textEn;
}

function messageText(message: ChatMessage, locale: AppLocale): string {
  if (message.kind === "quick_reply" && message.quickReply) {
    return quickReplyText(message.quickReply, locale);
  }
  return message.body ?? "";
}

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export default function ChatScreen({ rideId }: { rideId: string }) {
  const { t, locale } = useLocale();
  const { row, flipRows, backChevron } = useDirection();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const chat = useChatThread(rideId);
  const inputFamily = useFontFamily(400);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const messageCount = chat.messages.length + chat.pending.length;
  useEffect(() => {
    if (messageCount > 0) {
      // Keep the newest message in view (initial load and every arrival).
      const timer = setTimeout(
        () => scrollRef.current?.scrollToEnd({ animated: false }),
        0,
      );
      return () => clearTimeout(timer);
    }
  }, [messageCount]);

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  if (chat.status === "loading") {
    return <LoadingView testID="chat-loading" />;
  }
  if (chat.status === "missing") {
    return (
      <View style={[styles.page, { paddingTop: insets.top }]}>
        <View style={styles.stateHeader}>
          <BackButton
            onPress={leave}
            chevron={backChevron}
            label={t("chat.back")}
          />
        </View>
        <EmptyView
          title={t("chat.noChatTitle")}
          body={t("chat.noChatBody")}
          testID="chat-missing"
        />
      </View>
    );
  }
  if (chat.status === "error" || !chat.thread) {
    return (
      <View style={[styles.page, { paddingTop: insets.top }]}>
        <View style={styles.stateHeader}>
          <BackButton
            onPress={leave}
            chevron={backChevron}
            label={t("chat.back")}
          />
        </View>
        <EmptyView
          title={t("chat.errorTitle")}
          body={t("chat.errorBody")}
          icon="alert-circle-outline"
          testID="chat-error"
        />
        <View style={styles.retryWrap}>
          <TextButton
            label={t("common.retry")}
            onPress={chat.reload}
            testID="chat-retry"
          />
        </View>
      </View>
    );
  }

  const thread = chat.thread;
  const name = thread.counterpart.firstName;
  const phone = thread.counterpart.phone;
  const readOnly = !chat.canWrite;

  return (
    <View style={styles.page} testID="chat-screen">
      <ChatHeader
        thread={thread}
        rideId={rideId}
        onBack={leave}
        onCall={
          phone && !readOnly
            ? () => Linking.openURL(`tel:${phone}`).catch(() => {})
            : null
        }
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          testID="chat-messages"
        >
          {chat.hasEarlier ? (
            <TextButton
              label={t("chat.loadEarlier")}
              loading={chat.loadingEarlier}
              onPress={chat.loadEarlier}
              testID="chat-load-earlier"
            />
          ) : null}
          <MessageList
            messages={chat.messages}
            pending={chat.pending}
            counterpartSeenMessageId={chat.counterpartSeenMessageId}
            locale={locale}
            flipRows={flipRows}
            seenLabel={t("chat.seen")}
            sendingLabel={t("chat.sending")}
            todayLabel={t("chat.today")}
          />
        </ScrollView>
        {chat.sendFailed ? (
          <View style={styles.sendFailed}>
            <Banner
              tone="danger"
              message={t("chat.sendFailed")}
              testID="chat-send-failed"
            />
          </View>
        ) : null}
        {readOnly ? (
          <View
            style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
          >
            <Banner
              tone="neutral"
              message={t("chat.readOnlyNotice")}
              testID="chat-read-only"
            />
          </View>
        ) : (
          <View
            style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
          >
            {chat.quickReplies.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
                testID="chat-quick-replies"
              >
                {chat.quickReplies.map((reply) => (
                  <Pressable
                    key={reply.code}
                    accessibilityRole="button"
                    onPress={() => chat.sendQuickReply(reply)}
                    style={({ pressed }) => [
                      styles.chip,
                      pressed && styles.chipPressed,
                    ]}
                    testID={`chat-quick-reply-${reply.code}`}
                  >
                    <AppText variant="secondary" weight={700} numberOfLines={1}>
                      {quickReplyText(reply, locale)}
                    </AppText>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <View style={[styles.composer, { flexDirection: row }]}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={t("chat.placeholder", { name })}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={t("chat.messageLabel")}
                style={[
                  styles.input,
                  { fontFamily: inputFamily },
                  flipRows && styles.inputRtl,
                ]}
                maxLength={1000}
                multiline={false}
                onSubmitEditing={() => {
                  chat.sendText(draft);
                  setDraft("");
                }}
                testID="chat-input"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("chat.send")}
                onPress={() => {
                  chat.sendText(draft);
                  setDraft("");
                }}
                style={({ pressed }) => [
                  styles.sendButton,
                  pressed && styles.accentPressed,
                ]}
                testID="chat-send"
              >
                <Ionicons
                  name="send"
                  size={20}
                  color={colors.onAccent}
                  style={flipRows ? styles.mirrored : undefined}
                />
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

function BackButton({
  onPress,
  chevron,
  label,
}: {
  onPress: () => void;
  chevron: "chevron-back" | "chevron-forward";
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.roundButton, pressed && styles.fillPressed]}
      testID="chat-back"
    >
      <Ionicons name={chevron} size={20} color={colors.text} />
    </Pressable>
  );
}

function ChatHeader({
  thread,
  rideId,
  onBack,
  onCall,
}: {
  thread: ChatThread;
  rideId: string;
  onBack: () => void;
  /** Null hides the call button (no phone / read-only window). */
  onCall: (() => void) | null;
}) {
  const { t } = useLocale();
  const { row, backChevron } = useDirection();
  const insets = useSafeAreaInsets();
  const facade = useOptionalActiveRide();
  const name = thread.counterpart.firstName;

  // Vehicle + ride state come from the active ride when it is this one.
  const ride = facade?.ride?.id === rideId ? facade.ride : null;
  const vehicle = ride?.driver
    ? t("ride.vehicle", {
        color: ride.driver.vehicle.color,
        make: ride.driver.vehicle.make,
        model: ride.driver.vehicle.model,
      })
    : null;
  const stateLabel =
    ride?.state === "accepted"
      ? t("chat.statusOnTheWay")
      : ride?.state === "driver_arrived"
        ? t("chat.statusArrived")
        : ride?.state === "in_progress"
          ? t("chat.statusOnTrip")
          : null;
  const subtitle = [vehicle, stateLabel].filter(Boolean).join(" · ");

  return (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + spacing.sm, flexDirection: row },
      ]}
    >
      <BackButton onPress={onBack} chevron={backChevron} label={t("chat.back")} />
      {thread.counterpart.photoUrl ? (
        <Image
          source={{ uri: thread.counterpart.photoUrl }}
          style={styles.avatar}
          testID="chat-avatar-photo"
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFill]}>
          <AppText variant="bodyStrong" weight={800} tone="accent" align="center">
            {name.trim().charAt(0).toUpperCase() || "?"}
          </AppText>
        </View>
      )}
      <View style={styles.headerText}>
        <AppText variant="rowTitle" weight={800} testID="chat-name">
          {name}
        </AppText>
        {subtitle ? (
          <AppText
            variant="caption"
            tone="muted"
            weight={400}
            numberOfLines={1}
            testID="chat-subtitle"
          >
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {onCall ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.call", { name })}
          onPress={onCall}
          style={({ pressed }) => [styles.callButton, pressed && styles.accentPressed]}
          testID="chat-call"
        >
          <Ionicons name="call" size={20} color={colors.onAccent} />
        </Pressable>
      ) : null}
    </View>
  );
}

function MessageList({
  messages,
  pending,
  counterpartSeenMessageId,
  locale,
  flipRows,
  seenLabel,
  sendingLabel,
  todayLabel,
}: {
  messages: ChatMessage[];
  pending: PendingMessage[];
  counterpartSeenMessageId: string | null;
  locale: AppLocale;
  flipRows: boolean;
  seenLabel: string;
  sendingLabel: string;
  todayLabel: string;
}) {
  // "Seen" renders under the last own message at or before the counterpart's
  // read marker — only when it is the newest own message (artboard).
  const seenIndex = counterpartSeenMessageId
    ? messages.findIndex((m) => m.messageId === counterpartSeenMessageId)
    : -1;
  let lastSeenOwnId: string | null = null;
  if (seenIndex >= 0 && pending.length === 0) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].senderRole !== "rider") continue;
      if (i <= seenIndex) lastSeenOwnId = messages[i].messageId;
      break;
    }
  }

  const todayKey = dayKey(new Date().toISOString());
  // A day chip above the first message of each day ("Today 12:29").
  const chips = messages.map((message, index) => {
    const day = dayKey(message.sentAt);
    if (index > 0 && dayKey(messages[index - 1].sentAt) === day) return null;
    return day === todayKey
      ? `${todayLabel} ${formatClock(message.sentAt, locale)}`
      : formatDate(message.sentAt, locale);
  });

  return (
    <>
      {messages.map((message, index) => {
        const mine = message.senderRole === "rider";
        const chip = chips[index];
        return (
          <React.Fragment key={message.messageId}>
            {chip ? (
              <View style={styles.dayChip}>
                <AppText variant="caption" tone="muted" weight={700}>
                  {chip}
                </AppText>
              </View>
            ) : null}
            <Bubble
              mine={mine}
              flipRows={flipRows}
              text={messageText(message, locale)}
              time={formatClock(message.sentAt, locale)}
            />
            {mine && message.messageId === lastSeenOwnId ? (
              <AppText
                variant="caption"
                tone="muted"
                weight={700}
                style={[
                  styles.seen,
                  { alignSelf: flipRows ? "flex-start" : "flex-end" },
                ]}
                testID="chat-seen"
              >
                {seenLabel}
              </AppText>
            ) : null}
          </React.Fragment>
        );
      })}
      {pending.map((item) => (
        <Bubble
          key={item.clientMsgId}
          mine
          flipRows={flipRows}
          text={item.body ?? ""}
          time={sendingLabel}
          testID="chat-pending"
        />
      ))}
    </>
  );
}

function Bubble({
  mine,
  flipRows,
  text,
  time,
  testID,
}: {
  mine: boolean;
  flipRows: boolean;
  text: string;
  time: string;
  testID?: string;
}) {
  // The bubble hugs its screen edge; the small corner sits on that edge
  // (artboards EN + AR). `flipRows` mirrors the sides pre-restart in AR.
  const mineOnRight = !flipRows;
  const atRight = mine ? mineOnRight : !mineOnRight;
  return (
    <View
      style={[
        styles.bubble,
        mine ? styles.bubbleMine : styles.bubbleTheirs,
        { alignSelf: atRight ? "flex-end" : "flex-start" },
        atRight ? styles.cornerRight : styles.cornerLeft,
      ]}
      testID={testID ?? (mine ? "chat-bubble-mine" : "chat-bubble-theirs")}
    >
      <AppText
        variant="body"
        tone={mine ? "onAccent" : "default"}
        style={styles.bubbleText}
      >
        {text}
      </AppText>
      <AppText
        variant="caption"
        weight={400}
        style={[
          styles.bubbleTime,
          mine ? styles.bubbleTimeMine : styles.bubbleTimeTheirs,
          mine && { alignSelf: atRight ? "flex-end" : "flex-start" },
        ]}
      >
        {time}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  flex: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  roundButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  fillPressed: {
    backgroundColor: colors.line,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFill: {
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  callButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.round,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  accentPressed: {
    opacity: 0.8,
  },
  thread: {
    flex: 1,
    backgroundColor: THREAD_GROUND,
  },
  threadContent: {
    padding: spacing.lg,
    gap: 10,
  },
  dayChip: {
    alignSelf: "center",
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  bubble: {
    maxWidth: 280,
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 3,
  },
  bubbleMine: {
    backgroundColor: colors.accent,
  },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: BUBBLE_BORDER,
  },
  cornerRight: {
    borderBottomRightRadius: 4,
  },
  cornerLeft: {
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    lineHeight: 22,
  },
  bubbleTime: {
    fontSize: 11,
    lineHeight: 14,
  },
  bubbleTimeMine: {
    color: MINE_TIME,
  },
  bubbleTimeTheirs: {
    color: colors.textMuted,
  },
  seen: {
    marginTop: -4,
  },
  stateHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    alignItems: "flex-start",
  },
  retryWrap: {
    paddingBottom: spacing.xxxl,
    alignItems: "center",
  },
  sendFailed: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: THREAD_GROUND,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
    paddingTop: 10,
    paddingHorizontal: spacing.lg,
    gap: 10,
  },
  chips: {
    gap: spacing.sm,
  },
  chip: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.grabHandle,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  chipPressed: {
    backgroundColor: colors.surfaceFill,
  },
  composer: {
    alignItems: "center",
    gap: 10,
  },
  input: {
    flex: 1,
    height: touchTarget,
    borderWidth: 1.5,
    borderColor: colors.grabHandle,
    borderRadius: 24,
    paddingHorizontal: 18,
    fontSize: 15,
    color: colors.text,
  },
  inputRtl: {
    textAlign: "right",
  },
  sendButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.round,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
});
