import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Linking, StyleSheet, View } from "react-native";

import { ApiError } from "../../api/client";
import { getChatThread } from "../../api/comms";
import { getLostItemCase } from "../../api/support";
import type { LostItemCase } from "../../api/support-types";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { colors, radius, spacing } from "../../theme/tokens";
import { formatCount, formatDayMonthTime } from "../../trust/format";
import {
  AppText,
  Banner,
  FailureState,
  FieldLabel,
  Icon,
  LoadingState,
  Muted,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StatusChip,
  useDirection,
} from "../ui";
import { CASE_TONES } from "./tickets-screen";

type Load =
  | { status: "loading" }
  | { status: "loaded"; lostCase: LostItemCase; riderPhone: string | null }
  | { status: "gone" }
  | { status: "error"; kind: FailureKind };

/**
 * UC-D-21 (board D14LostCase): the case a rider opened on one of my rides —
 * status chip, the ride, what was lost (description + photos), and the two
 * actions: the reopened ride chat (writable while the case is open, M10
 * offline rule applies) and click-to-dial. The rider's phone comes from the
 * ride's chat thread (CALL-01 — non-null only while the window is writable);
 * the case payload itself carries no number. On a shared ride both go to the
 * reporter's member thread (`memberId`, support-v1 T6 amendment h).
 */
export function LostItemCaseScreen({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language, flipRows } = useDirection();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchCase = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const lostCase = await getLostItemCase(ticketId);
      let riderPhone: string | null = null;
      try {
        // A shared-ride case addresses the reporter's own member thread.
        const thread = await getChatThread(
          lostCase.ride.rideId,
          lostCase.memberId ?? undefined,
        );
        riderPhone = thread.counterpart.phone;
      } catch {
        // No thread / not readable — the call button simply hides (CALL-01).
      }
      if (mounted.current) setLoad({ status: "loaded", lostCase, riderPhone });
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
    void fetchCase();
  }, [fetchCase]);

  const loaded = load.status === "loaded" ? load : null;
  const lostCase = loaded?.lostCase ?? null;
  const open = lostCase ? lostCase.caseStatus !== "closed" : false;

  return (
    <Screen
      title={t("support.lost.title")}
      testID="lost-case-screen"
      footer={
        lostCase ? (
          <>
            {open ? (
              <PrimaryButton
                title={t("support.lost.openChat")}
                icon="chatbubble-ellipses-outline"
                onPress={() =>
                  router.push({
                    pathname: "/chat",
                    params: {
                      rideId: lostCase.ride.rideId,
                      ...(lostCase.memberId ? { memberId: lostCase.memberId } : {}),
                    },
                  })
                }
                testID="lost-case-open-chat"
              />
            ) : null}
            {loaded?.riderPhone ? (
              <SecondaryButton
                title={t("support.lost.call", { name: lostCase.reporter.name })}
                icon="call-outline"
                onPress={() => {
                  Linking.openURL(`tel:${loaded.riderPhone}`).catch(() => {});
                }}
                testID="lost-case-call"
              />
            ) : null}
            {open ? (
              <AppText
                variant="caption"
                weight="400"
                color={colors.textSecondary}
                style={styles.center}
              >
                {t("support.lost.offline")}
              </AppText>
            ) : null}
          </>
        ) : undefined
      }
    >
      {load.status === "loading" ? <LoadingState testID="lost-case-loading" /> : null}
      {load.status === "error" ? (
        <FailureState
          kind={load.kind}
          onRetry={() => void fetchCase()}
          testID="lost-case-error"
        />
      ) : null}
      {load.status === "gone" ? (
        <Muted testID="lost-case-gone">{t("support.lost.notFound")}</Muted>
      ) : null}

      {lostCase ? (
        <>
          <View style={[styles.metaRow, flipRows && styles.rowReverse]}>
            <StatusChip
              label={t(`support.caseStatus.${lostCase.caseStatus}`)}
              tone={CASE_TONES[lostCase.caseStatus]}
              testID="lost-case-status"
            />
            <AppText variant="caption" weight="400" color={colors.textMuted}>
              {t("support.lost.reportedAt", {
                date: formatDayMonthTime(lostCase.createdAt, language),
              })}
            </AppText>
          </View>

          <View style={[styles.ride, flipRows && styles.rowReverse]} testID="lost-case-ride">
            <View style={styles.rideIcon}>
              <Icon name="car-outline" size={16} color={colors.accent} />
            </View>
            <AppText variant="secondary" color={colors.textSecondary}>
              {t("support.lost.rideLine", {
                date: lostCase.ride.startedAt
                  ? formatDayMonthTime(lostCase.ride.startedAt, language)
                  : formatDayMonthTime(lostCase.createdAt, language),
                name: lostCase.reporter.name,
              })}
            </AppText>
          </View>

          <View style={styles.group}>
            <FieldLabel>{t("support.lost.whatLost")}</FieldLabel>
            <View style={styles.card}>
              <AppText
                variant="body"
                color={colors.textSecondary}
                testID="lost-case-description"
              >
                {lostCase.description}
              </AppText>
              {lostCase.photos.length > 0 ? (
                <View style={[styles.photos, flipRows && styles.rowReverse]}>
                  {lostCase.photos.map((photo, index) => (
                    <Image
                      key={photo.fileId}
                      source={{ uri: photo.url }}
                      style={styles.photo}
                      accessibilityLabel={t("support.lost.photo", {
                        n: formatCount(index + 1, language),
                      })}
                      testID={`lost-case-photo-${index}`}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          </View>

          <Banner
            tone={open ? "accent" : "neutral"}
            message={t(open ? "support.lost.note" : "support.lost.closedNote")}
            testID={open ? "lost-case-note" : "lost-case-closed-note"}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowReverse: { flexDirection: "row-reverse" },
  ride: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    backgroundColor: colors.surfacePage,
    borderRadius: radius.md,
    paddingVertical: spacing.ms,
    paddingHorizontal: spacing.md,
  },
  rideIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  group: { gap: spacing.sm },
  card: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.sm,
  },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  photo: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.surfaceFill,
  },
  center: { textAlign: "center" },
});
