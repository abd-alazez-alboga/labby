import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import type { Ride } from "../../api/ride-types";
import { getClaimBoard, getClaimedRides } from "../../api/scheduled";
import { formatNumber, placeLabel } from "../../rides/format";
import { formatWhen } from "../../scheduled/format";
import { colors, radius, spacing } from "../../theme/tokens";
import { AppText, Chevron, Icon, useDirection } from "../ui";

interface Summary {
  next: Ride | null;
  open: number | null;
}

/**
 * Artboard "Home · scheduled entry": the home sheet's "Scheduled rides" row
 * — the next claimed ride and how many rides are open on the board, read on
 * every focus of the home route. A failed read leaves the generic line; the
 * row always opens the board.
 */
export function ScheduledEntry() {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const live = useRef(true);

  useFocusEffect(
    useCallback(() => {
      live.current = true;
      void Promise.allSettled([getClaimedRides(), getClaimBoard(0, 1)]).then(
        ([claims, board]) => {
          if (!live.current) return;
          setSummary({
            next:
              claims.status === "fulfilled" ? (claims.value[0] ?? null) : null,
            open:
              board.status === "fulfilled" ? board.value.totalItems : null,
          });
        },
      );
      return () => {
        live.current = false;
      };
    }, []),
  );

  const parts: string[] = [];
  const next = summary?.next ?? null;
  if (next?.scheduled) {
    parts.push(
      t("scheduled.entry.next", {
        when: formatWhen(next.scheduled.scheduledAt, language),
        place: placeLabel(t, next.pickup),
      }),
    );
  }
  if (typeof summary?.open === "number") {
    parts.push(
      t("scheduled.entry.open", { count: formatNumber(summary.open, language) }),
    );
  }
  const subtitle = parts.length > 0 ? parts.join(" · ") : t("scheduled.entry.generic");

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/scheduled-rides")}
      style={({ pressed }) => [
        styles.row,
        flipRows && styles.rowReverse,
        pressed && styles.pressed,
      ]}
      testID="scheduled-entry"
    >
      <View style={styles.icon}>
        <Icon name="calendar-outline" color={colors.accent} />
      </View>
      <View style={styles.grow}>
        <AppText variant="rowTitle" weight="800">
          {t("scheduled.title")}
        </AppText>
        <AppText
          variant="caption"
          weight="400"
          color={colors.textSecondary}
          testID="scheduled-entry-subtitle"
        >
          {subtitle}
        </AppText>
      </View>
      <Chevron direction="forward" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: spacing.ms,
  },
  rowReverse: { flexDirection: "row-reverse" },
  pressed: { backgroundColor: colors.surfacePage },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.chip,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1, gap: 2 },
});
