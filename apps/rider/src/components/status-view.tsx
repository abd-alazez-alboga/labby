/**
 * Full-area loading / empty / error states shared by list screens, so every
 * screen distinguishes "no data" from "could not reach Labby" (network) and
 * "Labby answered with an error" (server) the same way.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { FailureKind } from '../api/http-client';
import { useLocale } from '../i18n/locale-context';
import { colors, fontSize, spacing } from '../theme/tokens';
import { Button } from './form';

export function LoadingView({ testID }: { testID?: string }) {
  return (
    <View style={styles.center} testID={testID}>
      <ActivityIndicator color={colors.purple700} size="large" />
    </View>
  );
}

export function EmptyView({
  title,
  body,
  icon = 'notifications-off-outline',
  testID,
}: {
  title: string;
  body?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  testID?: string;
}) {
  const { isRTL } = useLocale();
  return (
    <View style={styles.center} testID={testID}>
      <Ionicons name={icon} size={48} color={colors.textSubtle} />
      <Text style={[styles.title, isRTL && styles.textRtl]}>{title}</Text>
      {body ? <Text style={[styles.body, isRTL && styles.textRtl]}>{body}</Text> : null}
    </View>
  );
}

export function ErrorView({
  kind,
  onRetry,
  testID,
}: {
  kind: FailureKind;
  onRetry: () => void;
  testID?: string;
}) {
  const { t, isRTL } = useLocale();
  return (
    <View style={styles.center} testID={testID ?? `error-${kind}`}>
      <Ionicons
        name={kind === 'network' ? 'cloud-offline-outline' : 'alert-circle-outline'}
        size={48}
        color={colors.textSubtle}
      />
      <Text style={[styles.title, isRTL && styles.textRtl]}>{t(`common.${kind}ErrorTitle`)}</Text>
      <Text style={[styles.body, isRTL && styles.textRtl]}>{t(`common.${kind}ErrorBody`)}</Text>
      <Button label={t('common.retry')} onPress={onRetry} testID="error-retry" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  textRtl: {
    writingDirection: 'rtl',
  },
});
