/**
 * The per-seat split of a completed shared ride (RIDE-P4) — approved
 * artboard RiderSharedReceipt "Split by seat": seats that rode, the per-seat
 * amount (stored fare ÷ boarded seats, as the backend computed it), the
 * rider's party and THEIR share. Only stored values are shown — the
 * rounding remainder the backend gives one member is already in their share.
 */
import React from "react";
import { StyleSheet, View } from "react-native";

import type { MemberView, SplitSummary } from "../../api/scheduled-shared";
import { AppText, useDirection } from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { formatMoney } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

export function SharedSplit({
  split,
  me,
  testID = "shared-split",
}: {
  split: SplitSummary;
  me: MemberView | null | undefined;
  testID?: string;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const money = (amount: number) =>
    formatMoney(amount, split.currency, locale, t);
  const lines: { key: string; label: string; value: string }[] = [
    {
      key: "seats",
      label: t("shared.seatsRode"),
      value: String(split.boardedSeats),
    },
    {
      key: "per-seat",
      label: t("shared.perSeat", {
        total: money(split.fareTotal),
        seats: split.boardedSeats,
      }),
      value: money(split.perSeatAmount),
    },
  ];
  if (me) {
    lines.push({
      key: "party",
      label: t("shared.yourPartyLabel"),
      value:
        me.partySize === 1
          ? t("shared.partySeatsOne")
          : t("shared.partySeatsMany", { count: me.partySize }),
    });
  }
  return (
    <View style={styles.box} testID={testID}>
      <AppText variant="label" weight={800} tone="accent">
        {t("shared.splitTitle")}
      </AppText>
      {lines.map((line) => (
        <View
          key={line.key}
          style={[styles.line, { flexDirection: row }]}
          testID={`${testID}-${line.key}`}
        >
          <AppText variant="secondary" tone="secondary" style={styles.flex}>
            {line.label}
          </AppText>
          <AppText variant="secondary" weight={800}>
            {line.value}
          </AppText>
        </View>
      ))}
      {me?.shareAmount != null ? (
        <View
          style={[styles.line, styles.total, { flexDirection: row }]}
          testID={`${testID}-share`}
        >
          <AppText variant="bodyStrong" weight={800} style={styles.flex}>
            {t("shared.yourShare")}
          </AppText>
          <AppText variant="bodyStrong" weight={800}>
            {money(me.shareAmount)}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: spacing.sm,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.accentTint,
  },
  line: {
    alignItems: "center",
    gap: spacing.sm,
  },
  total: {
    borderTopWidth: 1,
    borderTopColor: colors.lineStrong,
    paddingTop: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
