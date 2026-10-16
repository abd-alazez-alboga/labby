import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";

import { useOptionalDriverRide } from "../../rides/DriverRideProvider";
import { colors } from "../../theme/tokens";
import { AppText, ListRow, Screen, useDirection } from "../ui";
import { RiderAvatar } from "../ride/ride-parts";
import { memberName, visibleMembers } from "../ride/shared-parts";

/**
 * Artboard "Per-member chats" (CHAT-01..03, owner ruling 2026-10-16): a
 * shared ride has ONE private thread per member with the driver — never
 * between members. Lists the ride's parties; each row opens that member's
 * thread on the chat screen.
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
    ? visibleMembers(shown).filter(
        (member) => member.status === "joined" || member.status === "completed",
      )
    : [];

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
            return (
              <ListRow
                key={member.memberId}
                title={name}
                subtitle={
                  member.partySize > 1
                    ? t("ride.shared.partyOf", { count: member.partySize })
                    : t("ride.shared.partyOfOne")
                }
                leading={<RiderAvatar firstName={name} />}
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
