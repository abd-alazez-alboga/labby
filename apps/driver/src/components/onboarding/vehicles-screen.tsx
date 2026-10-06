import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { getMyVehicles, resolveFileUrl } from '../../api/onboarding';
import type { Vehicle, VehicleWithDocuments } from '../../api/onboarding-types';
import { useLocale } from '../../i18n/LocaleProvider';
import { useRemote } from '../../onboarding/use-remote';
import { colors, radius, spacing } from '../../theme/tokens';
import { BodyText, PrimaryButton } from '../auth/ui';
import {
  Card,
  FailureState,
  KeyValue,
  LoadingState,
  Muted,
  NoteBox,
  SectionTitle,
  StatusChip,
  useRowStyle,
} from './ui';

function VehicleSummary({ vehicle }: { vehicle: Vehicle }) {
  const { t } = useTranslation();
  const rowStyle = useRowStyle();
  const cover = vehicle.photos[0];
  return (
    <View style={[rowStyle, styles.summary]}>
      {cover ? (
        <Image source={{ uri: resolveFileUrl(cover.url) }} style={styles.cover} />
      ) : null}
      <View style={styles.summaryText}>
        <SectionTitle>{`${vehicle.make} ${vehicle.model} · ${vehicle.year}`}</SectionTitle>
        <KeyValue label={t('onboarding.vehicle.plate')} value={vehicle.plate} />
        <KeyValue label={t('onboarding.vehicle.color')} value={vehicle.color} />
        <KeyValue label={t('onboarding.vehicle.seats')} value={String(vehicle.seats)} />
      </View>
    </View>
  );
}

/**
 * UC-D-18 — the active vehicle, a switch under review, and rejected
 * switches with their reasons; the entry to submitting a new vehicle.
 */
export function VehiclesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { language } = useLocale();
  const { state, refreshing, reload } = useRemote(getMyVehicles);

  const vehicles: VehicleWithDocuments[] = state.status === 'loaded' ? state.data : [];
  const active = vehicles.find((vehicle) => vehicle.active) ?? null;
  const pending = vehicles.find(
    (vehicle) => !vehicle.active && vehicle.reviewStatus === 'pending',
  );
  const rejected = vehicles.filter((vehicle) => vehicle.reviewStatus === 'rejected');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />
      }
      testID="vehicles-screen"
    >
      {state.status === 'loading' ? <LoadingState /> : null}
      {state.status === 'error' ? (
        <FailureState kind={state.kind} onRetry={() => void reload()} />
      ) : null}
      {state.status === 'loaded' ? (
        <>
          {active ? (
            <Card testID="vehicle-active">
              <StatusChip label={t('onboarding.vehicles.active')} tone="success" />
              <VehicleSummary vehicle={active} />
              {active.serviceTypes.length > 0 ? (
                <Muted testID="vehicle-active-service-types">
                  {t('onboarding.vehicles.serviceTypes', {
                    types: active.serviceTypes
                      .map((type) => (language === 'ar' ? type.nameAr : type.nameEn))
                      .join(language === 'ar' ? '، ' : ', '),
                  })}
                </Muted>
              ) : null}
            </Card>
          ) : (
            <BodyText testID="vehicle-none">{t('onboarding.vehicles.none')}</BodyText>
          )}

          {pending ? (
            <Card tone="warning" testID="vehicle-pending">
              <StatusChip label={t('onboarding.vehicles.pending')} tone="warning" />
              <VehicleSummary vehicle={pending} />
              <Muted>{t('onboarding.vehicles.pendingHint')}</Muted>
            </Card>
          ) : null}

          {rejected.length > 0 ? (
            <>
              <SectionTitle>{t('onboarding.vehicles.rejectedTitle')}</SectionTitle>
              {rejected.map((vehicle) => (
                <Card key={vehicle.id} testID={`vehicle-rejected-${vehicle.id}`}>
                  <StatusChip label={t('onboarding.vehicles.rejected')} tone="danger" />
                  <VehicleSummary vehicle={vehicle} />
                  <NoteBox
                    title={t('onboarding.vehicles.reason')}
                    note={vehicle.reviewNote ?? t('onboarding.documents.noReason')}
                  />
                </Card>
              ))}
            </>
          ) : null}

          {pending ? (
            <Muted testID="vehicle-switch-blocked">
              {t('onboarding.vehicles.switchBlocked')}
            </Muted>
          ) : null}
          <PrimaryButton
            title={t('onboarding.vehicles.switch')}
            onPress={() => router.push('/vehicle-switch')}
            disabled={!!pending}
            testID="vehicle-switch-start"
          />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgLight },
  content: { padding: spacing.lg, gap: spacing.sm },
  summary: { gap: spacing.md, alignItems: 'flex-start' },
  cover: {
    width: 88,
    height: 88,
    borderRadius: radius.sm,
    backgroundColor: colors.lavender100,
  },
  summaryText: { flex: 1, gap: spacing.xs },
});
