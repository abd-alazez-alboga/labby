import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../theme/tokens';

/** Unread counter pill; renders nothing for an unknown or zero count. */
export function UnreadBadge({ count, testID }: { count: number | null; testID?: string }) {
  if (!count || count <= 0) return null;
  return (
    <View style={styles.badge} testID={testID}>
      <Text style={styles.label}>{count > 99 ? '99+' : String(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: spacing.xs + 2,
    borderRadius: 10,
    backgroundColor: '#C0392B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
});
