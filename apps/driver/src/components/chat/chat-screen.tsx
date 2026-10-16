import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CHAT_BODY_MAX } from "../../api/comms-types";
import type { QuickReply } from "../../api/comms-types";
import { chatWritable, useOptionalChat } from "../../chat/ChatProvider";
import type { UiChatMessage } from "../../chat/ChatProvider";
import { setOpenChatRideId } from "../../notifications/open-chat";
import { useOptionalAvailability } from "../../realtime/AvailabilityProvider";
import { useOptionalDriverRide } from "../../rides/DriverRideProvider";
import { formatTime, placeLabel } from "../../rides/format";
import {
  BOTTOM_SAFE_MIN,
  colors,
  radius,
  spacing,
} from "../../theme/tokens";
import { fontFamilyFor } from "../../theme/fonts";
import { AppText, Banner, Chevron, Icon, LoadingState, FailureState, useDirection } from "../ui";

/**
 * The driver chat screen (UC-S-13/14, design canvas "Driver chat"): header
 * with the rider's first name, the pickup/drop-off context and the call
 * button; bubbles; a prominent 2-column grid of one-tap quick replies
 * (NFR-U2: one tap sends immediately while driving, ≥56 px targets); the
 * text input last. Window states (CHAT-01): open / reopened are the full
 * screen; read_only is history only — composer and call hidden behind a
 * short notice; no thread renders the empty "none" state (there is no
 * entry point to reach it, but a stale deep link can). An offline driver
 * (no realtime socket — `chat.send` is WS-only) in a writable window sees
 * the history with a "Go online to chat" note instead of the composer and
 * quick replies (owner ruling 2026-10-15); Call follows the phone rule.
 */

function quickReplyText(
  reply: QuickReply | null | undefined,
  code: string | null | undefined,
  catalog: QuickReply[],
  language: string,
): string {
  const entry = reply ?? catalog.find((item) => item.code === code) ?? null;
  if (!entry) return code ?? "";
  return language === "ar" ? entry.textAr : entry.textEn;
}

function Bubble({
  message,
  catalog,
  seen,
}: {
  message: UiChatMessage;
  catalog: QuickReply[];
  seen: boolean;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const own = message.senderRole === "driver";
  const text =
    message.kind === "quick_reply"
      ? quickReplyText(message.quickReply, message.quickReplyCode, catalog, language)
      : message.body ?? "";
  // Logical trailing side for own bubbles; the native layout stays LTR, so
  // RTL mirrors by hand (flipRows) like every row in the app — the flat
  // "tail" corner mirrors with it (AR artboard).
  const ownSide = flipRows ? styles.bubbleStart : styles.bubbleEnd;
  const otherSide = flipRows ? styles.bubbleEnd : styles.bubbleStart;
  const tail = (flipRows ? !own : own)
    ? styles.tailRight
    : styles.tailLeft;
  return (
    <View
      style={[styles.bubbleBlock, own ? ownSide : otherSide]}
      testID={`chat-message-${message.messageId}`}
    >
      <View
        style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleOther, tail]}
      >
        <AppText
          color={own ? colors.onAccent : colors.text}
          testID={`chat-bubble-text-${message.messageId}`}
        >
          {text}
        </AppText>
        <AppText
          variant="caption"
          weight="600"
          color={own ? colors.accentTint : colors.textMuted}
          style={own ? styles.timeOwn : null}
        >
          {message.pending
            ? t("chat.sending")
            : formatTime(message.sentAt, language)}
        </AppText>
      </View>
      {seen ? (
        <AppText
          variant="caption"
          weight="700"
          color={colors.textMuted}
          testID="chat-seen"
        >
          {t("chat.seen")}
        </AppText>
      ) : null}
    </View>
  );
}

export function ChatScreen() {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ rideId?: string; memberId?: string }>();
  const chat = useOptionalChat();
  const ride = useOptionalDriverRide()?.ride ?? null;
  // No socket at all (offline): sends could never leave the device.
  const offline = useOptionalAvailability()?.stream === "idle";
  const [draft, setDraft] = useState("");

  const paramRideId = typeof params.rideId === "string" ? params.rideId : null;
  // M12: the per-member chat list opens one shared-ride member's thread.
  const paramMemberId =
    typeof params.memberId === "string" && params.memberId ? params.memberId : null;
  const focusThread = chat?.focusThread;
  const chatRideId = chat?.rideId ?? null;
  const chatMemberId = chat?.memberId ?? null;
  const otherThread =
    paramRideId !== null &&
    (paramRideId !== chatRideId || paramMemberId !== chatMemberId);

  // A push deep link names the ride; focus it when it is not the active one.
  useFocusEffect(
    useCallback(() => {
      if (paramRideId && focusThread && otherThread) {
        focusThread(paramRideId, paramMemberId);
      }
    }, [paramRideId, paramMemberId, focusThread, otherThread]),
  );

  // The deep-linked thread is not the provider's yet (one render): show
  // nothing of the previous ride's thread meanwhile.
  const switching = otherThread;

  // While focused, a foreground chat push for the ride whose thread is
  // actually ON SCREEN shows no banner — the message lands live here
  // (owner ruling 2026-10-14, push.ts).
  const shownRideId = switching ? null : chatRideId;
  useFocusEffect(
    useCallback(
      () => (shownRideId ? setOpenChatRideId(shownRideId) : undefined),
      [shownRideId],
    ),
  );

  // Screen focus marks incoming messages read as they land (read markers).
  const setScreenOpen = chat?.setScreenOpen;
  useFocusEffect(
    useCallback(() => {
      setScreenOpen?.(true);
      return () => setScreenOpen?.(false);
    }, [setScreenOpen]),
  );

  const thread = chat?.thread ?? null;
  const writable = chatWritable(thread);
  const phone = writable ? thread?.counterpart.phone ?? null : null;
  const name = thread?.counterpart.firstName?.trim() || t("ride.theRider");
  const chatMessages = chat?.messages;
  const messages = useMemo(() => chatMessages ?? [], [chatMessages]);
  const catalog = chat?.quickReplies ?? [];

  // Newest first for the inverted list.
  const data = useMemo(() => [...messages].reverse(), [messages]);

  // "Seen" under the newest own message the rider's marker covers.
  const seenMessageId = useMemo(() => {
    const marker = thread?.counterpartLastReadMessageId;
    if (!marker) return null;
    const markerIndex = messages.findIndex((m) => m.messageId === marker);
    if (markerIndex < 0) return null;
    for (let i = markerIndex; i >= 0; i -= 1) {
      if (messages[i].senderRole === "driver" && !messages[i].pending)
        return messages[i].messageId;
    }
    return null;
  }, [messages, thread?.counterpartLastReadMessageId]);

  // Ride context under the name: pickup before the ride starts, drop-off after.
  const context = useMemo(() => {
    if (!ride || ride.id !== chatRideId) return null;
    return ride.state === "in_progress"
      ? t("chat.contextDropOff", { place: placeLabel(t, ride.destination) })
      : t("chat.contextPickup", { place: placeLabel(t, ride.pickup) });
  }, [ride, chatRideId, t]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    chat?.sendText(body);
    setDraft("");
  };

  const body = (() => {
    if (
      !chat ||
      switching ||
      chat.status === "loading" ||
      chat.status === "idle"
    ) {
      return <LoadingState testID="chat-loading" />;
    }
    if (chat.status === "error") {
      return (
        <View style={styles.statePad}>
          <FailureState
            kind="server"
            onRetry={() => void chat.refresh()}
            testID="chat-failure"
          />
        </View>
      );
    }
    if (chat.status === "none") {
      return (
        <View style={styles.statePad}>
          <AppText color={colors.textMuted} align="center" testID="chat-none">
            {t("chat.noThread")}
          </AppText>
        </View>
      );
    }
    return (
      <FlatList
        // An inverted empty list would mirror the empty-state text.
        inverted={data.length > 0}
        data={data}
        keyExtractor={(item) => item.messageId}
        renderItem={({ item }) => (
          <Bubble
            message={item}
            catalog={catalog}
            seen={item.messageId === seenMessageId}
          />
        )}
        contentContainerStyle={styles.listContent}
        onEndReached={() => {
          if (chat.hasOlder) void chat.loadOlder();
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <AppText color={colors.textMuted} align="center" testID="chat-empty">
            {t("chat.empty")}
          </AppText>
        }
        testID="chat-messages"
      />
    );
  })();

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      testID="chat-screen"
    >
      {/* ------------------------------------------------------- header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + spacing.sm },
          flipRows && styles.rowReverse,
        ]}
        testID="chat-header"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("nav.back")}
          onPress={() => router.back()}
          style={styles.headerButton}
          testID="chat-back"
        >
          <Chevron direction="back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.avatar}>
          <AppText variant="rowTitle" weight="800" color={colors.accent}>
            {name.charAt(0).toUpperCase()}
          </AppText>
        </View>
        <View style={styles.headerText}>
          <AppText variant="rowTitle" weight="800" testID="chat-title">
            {name}
          </AppText>
          {context ? (
            <AppText
              variant="caption"
              weight="600"
              color={colors.textMuted}
              numberOfLines={1}
              testID="chat-context"
            >
              {context}
            </AppText>
          ) : null}
        </View>
        {phone ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.call", { name })}
            onPress={() => {
              Linking.openURL(`tel:${phone}`).catch(() => {});
            }}
            style={[styles.headerButton, styles.callButton]}
            testID="chat-call"
          >
            <Icon name="call-outline" color={colors.onAccent} />
          </Pressable>
        ) : null}
      </View>

      {/* ------------------------------------------------------ messages */}
      <View style={styles.body}>{body}</View>

      {/* ------------------------------------------------------ composer */}
      {chat?.status === "loaded" && !switching ? (
        writable && offline ? (
          <View
            style={[
              styles.composer,
              { paddingBottom: Math.max(BOTTOM_SAFE_MIN, insets.bottom) },
            ]}
          >
            <Banner
              tone="neutral"
              message={t("chat.offline")}
              testID="chat-offline"
            />
          </View>
        ) : writable ? (
          <View
            style={[
              styles.composer,
              { paddingBottom: Math.max(BOTTOM_SAFE_MIN, insets.bottom) },
            ]}
          >
            <AppText variant="caption" weight="700" color={colors.textMuted}>
              {t("chat.quickRepliesLabel")}
            </AppText>
            {catalog.length > 0 ? (
              <View style={styles.quickGrid} testID="chat-quick-replies">
                {catalog.map((reply) => (
                  <Pressable
                    key={reply.code}
                    accessibilityRole="button"
                    // One tap SENDS — no confirm step (NFR-U2).
                    onPress={() => chat.sendQuickReply(reply.code)}
                    style={({ pressed }) => [
                      styles.quickReply,
                      pressed && styles.quickPressed,
                    ]}
                    testID={`quick-reply-${reply.code}`}
                  >
                    <AppText variant="body" weight="800" align="center">
                      {language === "ar" ? reply.textAr : reply.textEn}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View
              style={[styles.inputRow, flipRows && styles.rowReverse]}
              testID="chat-input-row"
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={t("chat.inputPlaceholder", { name })}
                placeholderTextColor={colors.textSubtle}
                maxLength={CHAT_BODY_MAX}
                style={[
                  styles.input,
                  {
                    fontFamily: fontFamilyFor("400", language),
                    textAlign: flipRows ? "right" : "left",
                  },
                ]}
                onSubmitEditing={send}
                returnKeyType="send"
                accessibilityLabel={t("chat.inputLabel")}
                testID="chat-input"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("chat.send")}
                accessibilityState={{ disabled: draft.trim().length === 0 }}
                onPress={send}
                style={({ pressed }) => [
                  styles.sendButton,
                  pressed && styles.sendPressed,
                  draft.trim().length === 0 && styles.sendDisabled,
                ]}
                testID="chat-send"
              >
                <Icon name="send" color={colors.onAccent} />
              </Pressable>
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.composer,
              { paddingBottom: Math.max(BOTTOM_SAFE_MIN, insets.bottom) },
            ]}
          >
            <Banner
              tone="neutral"
              message={t("chat.readOnly")}
              testID="chat-read-only"
            />
          </View>
        )
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  rowReverse: { flexDirection: "row-reverse" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.ms,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  headerButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  callButton: { backgroundColor: colors.accent },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1, gap: 1 },
  body: { flex: 1, backgroundColor: colors.surfacePage },
  statePad: { padding: spacing.ml },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 10,
  },
  bubbleBlock: { maxWidth: 280, gap: 3 },
  bubbleStart: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubbleEnd: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubble: {
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 3,
  },
  bubbleOwn: { backgroundColor: colors.accent },
  bubbleOther: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  // The flat 4 px "tail" corner sits on the bubble's screen edge side.
  tailRight: { borderBottomRightRadius: 4 },
  tailLeft: { borderBottomLeftRadius: 4 },
  timeOwn: { alignSelf: "flex-end" },
  composer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.ms,
    gap: spacing.ms,
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickReply: {
    // Two columns, ≥56 px one-tap targets (the approved artboard).
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.grabHandle,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  quickPressed: { backgroundColor: colors.surfaceFill },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: colors.grabHandle,
    paddingHorizontal: 18,
    fontSize: 15,
    color: colors.text,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendPressed: { backgroundColor: colors.accentPressed },
  sendDisabled: { opacity: 0.4 },
});
