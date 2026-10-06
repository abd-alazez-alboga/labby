import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DriverAvailability } from '../../api/realtime-types';
import { useLocale } from '../../i18n/LocaleProvider';
import { formatDateTime } from '../../onboarding/dates';
import { useOptionalAvailability } from '../../realtime/AvailabilityProvider';
import type { AvailabilityContextValue } from '../../realtime/AvailabilityProvider';
import { colors, radius, spacing } from '../../theme/tokens';
import { ErrorBanner } from '../auth/ui';
import { OsmMap } from '../map/osm-map';
import { Card, FailureState, SecondaryButton, StatusChip, useRowStyle, useTextAlign } from '../onboarding/ui';
import type { ChipTone } from '../onboarding/ui';

/** The blocked-state copy key for the GET's reason (UC-D-04 E1). */
function blockedKey(data: DriverAvailability): string {
  switch (data.cannotGoOnlineReason) {
    case 'role_suspended':
      return data.suspensionReason === 'document_expired'
        ? 'availability.blocked.document_expired'
        : 'availability.blocked.role_suspended';
    case 'not_approved':
      return 'availability.blocked.not_approved';
    case 'no_active_vehicle':
      return 'availability.blocked.no_active_vehicle';
    default:
      return 'availability.blocked.unknown';
  }
}

function StreamIndicator({ ctx }: { ctx: AvailabilityContextValue }) {
  const { t } = useTranslation();
  let key: string | null = null;
  let tone: ChipTone = 'info';
  if (ctx.stream === 'live') {
    if (ctx.serverHealthy === false) {
      key = 'stale';
      tone = 'warning';
    } else {
      key = 'live';
      tone = 'success';
    }
  } else if (ctx.stream === 'connecting') {
    key = 'connecting';
  } else if (ctx.stream === 'reconnecting') {
    key = 'reconnecting';
    tone = 'warning';
  }
  if (!key) return null;
  return (
    <StatusChip
      label={t(`availability.stream.${key}`)}
      tone={tone}
      testID={`stream-${key}`}
    />
  );
}

/** Large, glanceable online/offline control (NFR-U2). */
function BigToggle({
  online,
  disabled,
  busy,
  onPress,
}: {
  online: boolean;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const rowStyle = useRowStyle();
  const blocked = disabled || busy;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={t(online ? 'availability.goOffline' : 'availability.goOnline')}
      accessibilityState={{ checked: online, disabled: blocked, busy }}
      onPress={() => {
        if (!blocked) onPress();
      }}
      style={[
        rowStyle,
        styles.toggle,
        online ? styles.toggleOnline : styles.toggleOffline,
        blocked && styles.toggleDisabled,
      ]}
      testID="availability-toggle"
    >
      {busy ? (
        <ActivityIndicator color={online ? colors.purple700 : colors.white} />
      ) : (
        <>
          <Ionicons
            name="power"
            size={26}
            color={online ? colors.purple700 : colors.white}
          />
          <Text style={[styles.toggleText, online && styles.toggleTextOnline]}>
            {t(online ? 'availability.goOffline' : 'availability.goOnline')}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function GpsDeniedCard({ ctx, online }: { ctx: AvailabilityContextValue; online: boolean }) {
  const { t } = useTranslation();
  const textAlign = useTextAlign();
  return (
    <Card tone="warning" testID="gps-denied">
      <Text style={[styles.cardTitle, { textAlign }]}>{t('availability.gpsDeniedTitle')}</Text>
      <Text style={[styles.cardBody, { textAlign }]}>
        {t(online ? 'availability.gpsDeniedOnlineBody' : 'availability.gpsDeniedBody')}
      </Text>
      {!ctx.gpsCanAskAgain ? (
        <Text style={[styles.cardBody, { textAlign }]}>{t('availability.gpsBlockedHint')}</Text>
      ) : null}
      <SecondaryButton
        title={t('availability.openSettings')}
        icon="settings-outline"
        onPress={ctx.openSettings}
        testID="gps-open-settings"
      />
    </Card>
  );
}

/**
 * UC-D-04 on the driver home: the online/offline toggle with every blocked
 * state explained, the live-stream indicator and, while online, a map of
 * the driver's own position.
 */
export function AvailabilityCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { language } = useLocale();
  const textAlign = useTextAlign();
  const rowStyle = useRowStyle();
  const ctx = useOptionalAvailability();
  if (!ctx) return null;
  const { load } = ctx;

  if (load.status === 'loading') {
    return (
      <Card testID="availability-loading">
        <View style={[rowStyle, styles.loadingRow]}>
          <ActivityIndicator color={colors.purple700} />
          <Text style={styles.cardBody}>{t('availability.loading')}</Text>
        </View>
      </Card>
    );
  }
  if (load.status === 'error') {
    return (
      <FailureState
        kind={load.kind}
        onRetry={() => void ctx.reload()}
        testID={`availability-error-${load.kind}`}
      />
    );
  }
  if (load.status === 'noProfile') {
    return (
      <Card testID="availability-no-profile">
        <Text style={[styles.cardBody, { textAlign }]}>{t('availability.noProfile')}</Text>
      </Card>
    );
  }

  const { data } = load;
  const online = data.online;
  const blocked = !online && !data.canGoOnline;
  const expired =
    data.cannotGoOnlineReason === 'role_suspended' && data.suspensionReason === 'document_expired';

  return (
    <View style={styles.container} testID={online ? 'availability-online' : 'availability-offline'}>
      <Card tone={online ? 'success' : undefined}>
        <View style={[rowStyle, styles.statusRow]}>
          <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
          <Text style={[styles.statusTitle, { textAlign }]} testID="availability-status">
            {t(online ? 'availability.onlineTitle' : 'availability.offlineTitle')}
          </Text>
        </View>
        {online && data.onlineSince ? (
          <Text style={[styles.cardBody, { textAlign }]}>
            {t('availability.onlineSince', { time: formatDateTime(data.onlineSince, language) })}
          </Text>
        ) : null}
        {online ? <StreamIndicator ctx={ctx} /> : null}
        {!blocked ? (
          <Text style={[styles.cardBody, { textAlign }]}>
            {t(online ? 'availability.onlineHint' : 'availability.offlineHint')}
          </Text>
        ) : null}
      </Card>

      {blocked ? (
        <Card tone="danger" testID={`availability-blocked-${data.cannotGoOnlineReason ?? 'unknown'}`}>
          <Text style={[styles.cardTitle, { textAlign }]}>{t('availability.blockedTitle')}</Text>
          <Text style={[styles.cardBody, { textAlign }]} testID="availability-blocked-reason">
            {t(blockedKey(data))}
          </Text>
          {expired ? (
            <SecondaryButton
              title={t('availability.renewDocuments')}
              icon="document-text-outline"
              onPress={() => router.push('/documents')}
              testID="availability-renew-documents"
            />
          ) : null}
          {data.cannotGoOnlineReason === 'no_active_vehicle' ? (
            <SecondaryButton
              title={t('availability.manageVehicle')}
              icon="car-outline"
              onPress={() => router.push('/vehicles')}
              testID="availability-manage-vehicle"
            />
          ) : null}
        </Card>
      ) : null}

      {online && data.offersBlockedReason ? (
        <Card tone="warning" testID="offers-blocked">
          <Text style={[styles.cardTitle, { textAlign }]}>{t('availability.offersBlockedTitle')}</Text>
          <Text style={[styles.cardBody, { textAlign }]}>{t('availability.offersBlockedBody')}</Text>
        </Card>
      ) : null}

      {ctx.gps === 'denied' && !blocked ? <GpsDeniedCard ctx={ctx} online={online} /> : null}

      {online && ctx.gps === 'granted' && ctx.gpsUnavailable ? (
        <ErrorBanner testID="gps-unavailable">{t('availability.gpsUnavailable')}</ErrorBanner>
      ) : null}

      {ctx.actionError ? (
        <ErrorBanner testID={`availability-action-error-${ctx.actionError}`}>
          {t(`availability.errors.${ctx.actionError}`)}
        </ErrorBanner>
      ) : null}

      <BigToggle
        online={online}
        disabled={blocked}
        busy={ctx.pending !== null}
        onPress={() => void (online ? ctx.goOffline() : ctx.goOnline())}
      />

      {online && ctx.gps === 'granted' ? (
        ctx.position ? (
          <OsmMap
            center={{ lat: ctx.position.lat, lng: ctx.position.lng }}
            markers={[
              {
                id: 'self',
                kind: 'self',
                position: { lat: ctx.position.lat, lng: ctx.position.lng },
              },
            ]}
            followMe
            height={260}
            testID="own-position-map"
          />
        ) : (
          <View style={[rowStyle, styles.waiting]} testID="waiting-for-gps">
            <ActivityIndicator color={colors.purple700} />
            <Text style={styles.cardBody}>{t('availability.waitingForGps')}</Text>
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', gap: spacing.sm },
  loadingRow: { gap: spacing.sm },
  statusRow: { gap: spacing.sm },
  dot: { width: 14, height: 14, borderRadius: 7 },
  dotOnline: { backgroundColor: colors.success },
  dotOffline: { backgroundColor: colors.textSubtle },
  statusTitle: { color: colors.text, fontSize: 22, fontWeight: '800', flexShrink: 1 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  cardBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  toggle: {
    minHeight: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  toggleOffline: { backgroundColor: colors.purple700 },
  toggleOnline: {
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.purple700,
  },
  toggleDisabled: { opacity: 0.45 },
  toggleText: { color: colors.white, fontSize: 20, fontWeight: '800' },
  toggleTextOnline: { color: colors.purple700 },
  waiting: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.lavender100,
    borderRadius: radius.md,
  },
});
