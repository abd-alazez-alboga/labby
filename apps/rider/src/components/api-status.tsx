import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getMeta, type ApiMeta } from '../api/meta';
import { useLocale } from '../i18n/locale-context';
import { colors, fontSize, spacing } from '../theme/tokens';

type ApiStatusState = { kind: 'loading' } | { kind: 'ok'; meta: ApiMeta } | { kind: 'offline' };

/**
 * Shows the backend's live version fetched on mount, or a friendly offline
 * note when the API is unreachable. Never throws — a dead backend must not
 * crash the shell.
 */
export function ApiStatus() {
  const { t, isRTL } = useLocale();
  const [state, setState] = useState<ApiStatusState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getMeta()
      .then((meta) => {
        if (!cancelled) setState({ kind: 'ok', meta });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'offline' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const text =
    state.kind === 'loading'
      ? t('settings.apiChecking')
      : state.kind === 'offline'
        ? t('settings.apiOffline')
        : `${t('settings.apiVersionLabel')} ${state.meta.version}`;

  return (
    <View style={styles.container} testID={`api-status-${state.kind}`}>
      <Text style={[styles.text, isRTL && styles.textRtl]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
  },
  text: {
    color: colors.textSubtle,
    fontSize: fontSize.sm,
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
});
