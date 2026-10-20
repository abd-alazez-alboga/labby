import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import { getHelpCategories, getLostItemCases, getTickets } from "../../api/support";
import type { HelpCategory, LostItemCase, Ticket } from "../../api/support-types";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { colors, radius, spacing } from "../../theme/tokens";
import { countCopy } from "../../trust/format";
import {
  AppText,
  FailureState,
  Icon,
  ListRow,
  LoadingState,
  PrimaryButton,
  Screen,
  SecondaryButton,
  useDirection,
} from "../ui";

/** Icons cycle by list position — help categories carry no icon of their own. */
const CATEGORY_ICONS = [
  "car-outline",
  "card-outline",
  "person-outline",
  "shield-outline",
  "document-text-outline",
  "chatbubble-ellipses-outline",
] as const;

interface TicketsGlance {
  /** Non-closed tickets + the driver's non-closed lost-item cases. */
  openCount: number;
  /** Sum of unread support messages (first page — a glance, not a ledger). */
  unread: number;
}

type Load =
  | { status: "loading" }
  | { status: "loaded"; categories: HelpCategory[]; glance: TicketsGlance }
  | { status: "error"; kind: FailureKind };

function glanceOf(tickets: Ticket[], cases: LostItemCase[]): TicketsGlance {
  const caseIds = new Set(cases.map((item) => item.ticketId));
  const openTickets = tickets.filter(
    (ticket) => ticket.status !== "closed" && !caseIds.has(ticket.ticketId),
  );
  return {
    openCount:
      openTickets.length + cases.filter((item) => item.caseStatus !== "closed").length,
    unread: tickets.reduce((sum, ticket) => sum + ticket.unreadSupportMessages, 0),
  };
}

/**
 * UC-S-19/21 entry (board S14Support): the help center FIRST — search entry
 * and the published help topics — then "Your tickets" with the unread badge,
 * and "Create a ticket" / "Share feedback" pinned last (UC-S-21 A1).
 */
export function SupportHomeScreen() {
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

  const fetchAll = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const [categories, tickets, cases] = await Promise.all([
        getHelpCategories(),
        getTickets(0, 50),
        getLostItemCases({ open: true, page: 0, size: 50 }),
      ]);
      if (!mounted.current) return;
      setLoad({
        status: "loaded",
        categories,
        glance: glanceOf(tickets.items, cases.items),
      });
    } catch (caught) {
      if (mounted.current) setLoad({ status: "error", kind: failureKindOf(caught) });
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return (
    <Screen
      title={t("support.title")}
      testID="support-home-screen"
      footer={
        <>
          <AppText
            variant="caption"
            weight="400"
            color={colors.textSecondary}
            style={styles.center}
          >
            {t("support.cantFind")}
          </AppText>
          <PrimaryButton
            title={t("support.createTicket")}
            onPress={() => router.push("/ticket-create")}
            testID="support-create-ticket"
          />
          <SecondaryButton
            title={t("support.shareFeedback")}
            onPress={() => router.push("/feedback")}
            testID="support-feedback"
          />
        </>
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("support.searchEntry")}
        onPress={() => router.push("/help-search")}
        style={[styles.search, flipRows && styles.rowReverse]}
        testID="support-search-entry"
      >
        <Icon name="search" size={18} color={colors.textMuted} />
        <AppText variant="bodyStrong" color={colors.textMuted}>
          {t("support.searchEntry")}
        </AppText>
      </Pressable>

      <AppText variant="rowTitle" weight="800">
        {t("support.topics")}
      </AppText>

      {load.status === "loading" ? <LoadingState testID="support-loading" /> : null}
      {load.status === "error" ? (
        <FailureState
          kind={load.kind}
          onRetry={() => void fetchAll()}
          testID="support-error"
        />
      ) : null}
      {load.status === "loaded" ? (
        <>
          {load.categories.length === 0 ? (
            // I99: no published help content yet — say so, not a bare heading.
            <AppText
              variant="secondary"
              color={colors.textMuted}
              testID="support-topics-empty"
            >
              {t("support.noTopics")}
            </AppText>
          ) : null}
          <View testID="support-topics">
            {load.categories.map((category, index) => (
              <ListRow
                key={category.helpCategoryId}
                icon={CATEGORY_ICONS[index % CATEGORY_ICONS.length]}
                title={category.name[language === "ar" ? "ar" : "en"]}
                subtitle={countCopy(
                  t,
                  "support.articleCount",
                  category.articleCount,
                  language,
                )}
                chevron
                onPress={() =>
                  router.push({
                    pathname: "/help-category",
                    params: {
                      helpCategoryId: category.helpCategoryId,
                      nameEn: category.name.en,
                      nameAr: category.name.ar,
                      count: String(category.articleCount),
                    },
                  })
                }
                last={index === load.categories.length - 1}
                testID={`support-topic-${category.helpCategoryId}`}
              />
            ))}
          </View>

          <View style={styles.rule} />

          <ListRow
            icon="chatbubble-ellipses-outline"
            title={t("support.yourTickets")}
            subtitle={
              load.glance.openCount > 0
                ? countCopy(t, "support.openTickets", load.glance.openCount, language)
                : t("support.noTickets")
            }
            trailing={
              load.glance.unread > 0 ? (
                <View
                  style={styles.badge}
                  accessibilityLabel={t("support.unreadBadge", {
                    count: load.glance.unread,
                  })}
                  testID="support-unread-badge"
                >
                  <AppText variant="caption" weight="800" color={colors.onAccent}>
                    {load.glance.unread}
                  </AppText>
                </View>
              ) : undefined
            }
            chevron
            onPress={() => router.push("/tickets")}
            last
            testID="support-your-tickets"
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
  },
  rowReverse: { flexDirection: "row-reverse" },
  rule: { height: 1, backgroundColor: colors.line },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { textAlign: "center" },
});
