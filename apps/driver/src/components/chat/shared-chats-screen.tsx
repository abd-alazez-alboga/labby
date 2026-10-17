import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { getChatThread } from "../../api/comms";
import type { MemberView } from "../../api/scheduled-types";
import { useOptionalDriverRide } from "../../rides/DriverRideProvider";
import { colors } from "../../theme/tokens";
import { AppText, ListRow, Screen, useDirection } from "../ui";
import { RiderAvatar } from "../ride/ride-parts";
import { memberName, visibleMembers } from "../ride/shared-parts";

/** Members whose private thread the driver can still open (M12 review W13). */
const WITH_THREAD: readonly MemberView["status"][] = [
  "joined",
  "completed",
  "cancelled",
  "no_show",
];

/**
 * Artboard "Per-member chats" (CHAT-01..03, owner ruling 2026-10-16): a
 * shared ride has ONE private thread per member with the driver — never
 * between members. Lists the ride's parties — also those who cancelled or
 * were marked absent, whose thread stays open 24 h after they left — with
 * each thread's unread count (its GET, re-read on focus); each row opens
 * that member's thread on the chat screen.
 */
export function SharedChatsScreen() {
  const { t } = useTranslation();
  const { language } = useDirection();
  const router = useRouter();
  const params = useLocalSearchParams<{ rideId?: string }>();
  const ride = useOptionalDriverRide()?.ride ?? null;
  const shown =
    ride && ride.kind === "shared" && (!params.rideId || params.rideId === ride.id)
      ? ride
      : null;
  const members = shown
    ? visibleMembers(shown).filter((member) => WITH_THREAD.includes(member.status))
    : [];
  const [unread, setUnread] = useState<Record<string, number>>({});
  const memberKey = members.map((member) => member.memberId).join(",");
  const rideId = shown?.id ?? null;

  useFocusEffect(
    useCallback(() => {
      if (!rideId || !memberKey) return undefined;
      let cancelled = false;
      for (const memberId of memberKey.split(",")) {
        getChatThread(rideId, memberId)
          .then((thread) => {
            if (!cancelled) {
              setUnread((counts) => ({ ...counts, [memberId]: thread.unreadCount }));
            }
          })
          .catch(() => {
            // No thread (never accepted / window gone): no badge.
          });
      }
      return () => {
        cancelled = true;
      };
    }, [rideId, memberKey]),
  );

  return (
    <Screen title={t("chat.sharedTitle")} testID="shared-chats-screen">
      <AppText color={colors.textSecondary}>{t("chat.sharedIntro")}</AppText>
      {!shown ? (
        <AppText color={colors.textMuted} testID="shared-chats-none">
          {t("chat.sharedNone")}
        </AppText>
      ) : null}
      {shown
        ? members.map((member, index) => {
            const name = memberName(t, member, index, language);
            const party =
              member.partySize > 1
                ? t("ride.shared.partyOf", { count: member.partySize })
                : t("ride.shared.partyOfOne");
            const count = unread[member.memberId] ?? 0;
            return (
              <ListRow
                key={member.memberId}
                title={name}
                subtitle={
                  member.status === "cancelled" || member.status === "no_show"
                    ? `${party} · ${t(`ride.shared.status.${member.status}`)}`
                    : party
                }
                leading={<RiderAvatar firstName={name} />}
                trailing={
                  count > 0 ? (
                    <View
                      style={styles.badge}
                      testID={`shared-chat-unread-${member.memberId}`}
                    >
                      <AppText
                        variant="caption"
                        weight="800"
                        color={colors.onAccent}
                        align="center"
                        style={styles.badgeText}
                      >
                        {count > 99 ? "99+" : String(count)}
                      </AppText>
                    </View>
                  ) : undefined
                }
                chevron
                last={index === members.length - 1}
                onPress={() =>
                  router.push({
                    pathname: "/chat",
                    params: { rideId: shown.id, memberId: member.memberId },
                  })
                }
                testID={`shared-chat-${member.memberId}`}
              />
            );
          })
        : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 13, lineHeight: 16 },
});
