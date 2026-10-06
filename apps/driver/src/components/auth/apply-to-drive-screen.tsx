import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from './ui';
import { getMyProfile } from '../../api/auth';
import { driverRoleOf, hasActiveDriverRole } from '../../api/auth-types';
import { getMyApplication } from '../../api/onboarding';
import { useAuth } from '../../auth/AuthProvider';
import { useLocale } from '../../i18n/LocaleProvider';
import { failureKindOf } from '../../onboarding/server-errors';
import { useRemote } from '../../onboarding/use-remote';
import { colors, gradients, radius, spacing } from '../../theme/tokens';
import { NotificationsBell } from '../notifications/notifications-bell';
import { ApplicationTracker } from '../onboarding/application-tracker';
import { Card, FailureState, FieldError, LoadingState, Muted, SecondaryButton, SectionTitle } from '../onboarding/ui';

// Brand asset copied from /assets/images/labby-logo-white.png (source of truth).
const logoWhite = require('../../../assets/images/labby-logo-white.png');

const NOT_FOUND = [404] as const;

/** Re-reads /users/me; the root stack re-evaluates the driver gate from it. */
function useProfileRefresh() {
  const { setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const profile = await getMyProfile();
      await setUser(profile);
      return profile;
    } catch (error) {
      setErrorKey(`onboarding.errors.${failureKindOf(error)}`);
      return null;
    } finally {
      setBusy(false);
    }
  }, [setUser]);

  return { busy, errorKey, setErrorKey, refresh };
}

function GateLayout({
  title,
  body,
  children,
  refreshing,
  onRefresh,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { direction } = useLocale();
  const textAlign = direction === 'rtl' ? 'right' : 'left';

  return (
    <View style={styles.container} testID="apply-to-drive-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} />
          ) : undefined
        }
      >
        <View style={styles.hero}>
          {/* Applicants get their stage updates in the center too (UC-S-11). */}
          <View style={[styles.bell, direction === 'rtl' ? styles.bellRtl : null]}>
            <NotificationsBell />
          </View>
          <Image
            source={logoWhite}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel={t('app.name')}
          />
          <Text style={[styles.title, { textAlign }]} testID="gate-title">
            {title}
          </Text>
          <Text style={[styles.subtitle, { textAlign }]} testID="gate-body">
            {body}
          </Text>
        </View>
        <View style={styles.content}>{children}</View>
        <View style={styles.footer}>
          {user ? (
            <Text style={[styles.signedInAs, { textAlign }]} testID="gate-user">
              {t('gate.signedInAs', { name: user.name })}
            </Text>
          ) : null}
          <PrimaryButton
            title={t('gate.logout')}
            onPress={() => signOut()}
            testID="gate-logout"
          />
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Driver role suspended. A `document_expired` suspension (DRV-04) explains
 * itself and leads straight to renewal; any other reason keeps the generic
 * suspended copy (reasons arrive with later milestones).
 */
function SuspendedGate({ expired }: { expired: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useProfileRefresh();

  if (!expired) {
    return <GateLayout title={t('gate.suspendedTitle')} body={t('gate.suspendedBody')} />;
  }
  return (
    <GateLayout title={t('gate.expiredTitle')} body={t('gate.expiredBody')}>
      <Card tone="danger" testID="gate-expired">
        <SectionTitle>{t('gate.expiredWhatNow')}</SectionTitle>
        <Muted>{t('gate.expiredSteps')}</Muted>
        <PrimaryButton
          title={t('gate.renewDocuments')}
          onPress={() => router.push('/documents')}
          testID="gate-renew"
        />
      </Card>
      <SecondaryButton
        title={t('gate.checkStatus')}
        icon="refresh"
        onPress={() => void profile.refresh()}
        disabled={profile.busy}
        testID="gate-check-status"
      />
      {profile.errorKey ? <FieldError>{t(profile.errorKey)}</FieldError> : null}
    </GateLayout>
  );
}

/** No driver role yet: application intro (never applied) or the stage tracker. */
function ApplicationGate() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, refreshing, reload } = useRemote(getMyApplication, NOT_FOUND);
  const profile = useProfileRefresh();
  const { refresh: refreshProfile, setErrorKey } = profile;
  const approvedId =
    state.status === 'loaded' && state.data.status === 'approved' ? state.data.id : null;

  const openDriverHome = useCallback(async () => {
    const fresh = await refreshProfile();
    if (fresh && !hasActiveDriverRole(fresh)) {
      setErrorKey('onboarding.tracker.notActiveYet');
    }
  }, [refreshProfile, setErrorKey]);

  // UC-D-03 A1: once approved, pick up the activated driver role right away.
  useEffect(() => {
    if (approvedId) void openDriverHome();
  }, [approvedId, openDriverHome]);

  if (state.status === 'loaded') {
    const application = state.data;
    return (
      <GateLayout
        title={t('onboarding.tracker.title')}
        body={t(`onboarding.status.${application.status}.body`)}
        refreshing={refreshing}
        onRefresh={() => void reload()}
      >
        <ApplicationTracker
          application={application}
          refreshing={refreshing}
          onRefresh={() => void reload()}
          onContinueApproved={() => void openDriverHome()}
          approvedBusy={profile.busy}
        />
        {profile.errorKey ? (
          <FieldError testID="gate-profile-error">{t(profile.errorKey)}</FieldError>
        ) : null}
      </GateLayout>
    );
  }

  return (
    <GateLayout title={t('gate.title')} body={t('gate.body')}>
      {state.status === 'loading' ? <LoadingState /> : null}
      {state.status === 'error' ? (
        <FailureState kind={state.kind} onRetry={() => void reload()} />
      ) : null}
      {state.status === 'absent' ? (
        <Card testID="gate-intro">
          <SectionTitle>{t('gate.needTitle')}</SectionTitle>
          <Muted>{t('gate.needPersonal')}</Muted>
          <Muted>{t('gate.needDocuments')}</Muted>
          <Muted>{t('gate.needVehicle')}</Muted>
          <PrimaryButton
            title={t('gate.start')}
            onPress={() => router.push('/driver-application')}
            testID="gate-start"
          />
        </Card>
      ) : null}
    </GateLayout>
  );
}

/**
 * The driver gate: shown to signed-in accounts WITHOUT an active `driver`
 * role. It hosts the driver application (UC-D-01) entry, the stage tracker
 * (UC-D-03) and the suspended states (USR-04, DRV-04).
 */
export function ApplyToDriveScreen() {
  const { user } = useAuth();
  const driverRole = user ? driverRoleOf(user) : null;
  if (driverRole?.state === 'suspended') {
    return <SuspendedGate expired={driverRole.suspensionReason === 'document_expired'} />;
  }
  return <ApplicationGate />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgLight,
  },
  scroll: {
    flexGrow: 1,
  },
  hero: {
    // Solid fallback for --labby-gradient-hero.
    backgroundColor: gradients.hero[0],
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  logo: {
    width: 180,
    height: 40,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  bell: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 1,
  },
  bellRtl: { right: undefined, left: spacing.sm },
  title: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.lilac200,
    fontSize: 15,
    lineHeight: 22,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 0,
    gap: spacing.sm,
  },
  footer: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  signedInAs: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
});
