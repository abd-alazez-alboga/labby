import React from "react";
import { StyleSheet, View } from "react-native";

import { AppText } from "../components/ui";
import { colors, radius } from "../theme/tokens";

/** Unread counter pill (accent); renders nothing for an unknown or zero count. */
export function UnreadBadge({
  count,
  testID,
}: {
  count: number | null;
  testID?: string;
}) {
  if (!count || count <= 0) return null;
  return (
    <View style={styles.badge} testID={testID}>
      <AppText
        variant="caption"
        weight={800}
        tone="onAccent"
        align="center"
        style={styles.label}
      >
        {count > 99 ? "99+" : String(count)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.round,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
  },
});
