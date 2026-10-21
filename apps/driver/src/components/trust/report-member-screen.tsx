import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";

import type { MemberView } from "../../api/scheduled-types";
import { useOptionalDriverRide } from "../../rides/DriverRideProvider";
import { placeLabel } from "../../rides/format";
import { colors } from "../../theme/tokens";
import { isReported } from "../../trust/reported-members";
import { AppText, Icon, ListRow, Screen, useDirection } from "../ui";
import { RiderAvatar } from "../ride/ride-parts";
import { memberName, visibleMembers } from "../ride/shared-parts";

/**
 * Artboard "Report a rider · pick the member (shared)" (M12-T5, REP-01 per
 * member): on a shared ride each report is about ONE party. Lists every
 * party that was with the ride after dispatch (absent and cancelled ones
 * included — scheduled-shared-v1); a row opens the report screen for that
 * member. Members reported in this session show as "Already reported".
 */
export function ReportMemberScreen() {
  const { t } = useTranslation();
  const { language } = useDirection();
  const router = useRouter();
  const params = useLocalSearchParams<{ rideId?: string }>();
  const ride = useOptionalDriverRide()?.ride ?? null;
  const shown =
    ride && ride.kind === "shared" && (!params.rideId || params.rideId === ride.id)
      ? ride
      : null;
  const members = shown ? visibleMembers(shown) : [];
  const when = shown
    ? (shown.timeline.startedAt ?? shown.timeline.acceptedAt ?? null)
    : null;
  // L-W2: a pinned / current-location point reads as the localized fallback.
  const place = shown ? placeLabel(t, shown.destination) : null;

  const subtitle = (member: MemberView): string => {
    const party =
      member.partySize > 1
        ? t("ride.shared.partyOf", { count: member.partySize })
        : t("ride.shared.partyOfOne");
    switch (member.status) {
      case "no_show":
        return t("trust.report.pickAbsent", { party });
      case "cancelled":
        return t("trust.report.pickCancelled", { party });
      default:
        return t("trust.report.pickOnBoard", { party });
    }
  };

  return (
    <Screen title={t("trust.report.pickTitle")} testID="report-member-screen">
      <AppText color={colors.textSecondary}>{t("trust.report.pickIntro")}</AppText>
      {!shown ? (
        <AppText color={colors.textMuted} testID="report-member-none">
          {t("trust.report.pickNone")}
        </AppText>
      ) : null}
      {shown
        ? members.map((member, index) => {
            const first = memberName(t, member, index, language);
            const title = member.isCreator
              ? t("ride.shared.creator", { name: first })
              : first;
            const done = isReported(shown.id, member.memberId);
            return (
              <ListRow
                key={member.memberId}
                title={title}
                subtitle={done ? t("trust.report.pickAlready") : subtitle(member)}
                leading={<RiderAvatar firstName={first} />}
                chevron={!done}
                trailing={
                  done ? (
                    <Icon name="checkmark" size={20} color={colors.success} />
                  ) : undefined
                }
                disabled={done}
                last={index === members.length - 1}
                onPress={
                  done
                    ? undefined
                    : () =>
                        router.push({
                          pathname: "/report-rider",
                          params: {
                            rideId: shown.id,
                            memberId: member.memberId,
                            name: first,
                            ...(when ? { when } : {}),
                            ...(place ? { place } : {}),
                          },
                        })
                }
                testID={`report-member-${member.memberId}`}
              />
            );
          })
        : null}
      {shown ? (
        <AppText variant="caption" color={colors.textMuted}>
          {t("trust.report.pickFootnote")}
        </AppText>
      ) : null}
    </Screen>
  );
}
