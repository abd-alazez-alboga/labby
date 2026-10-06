import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import type { ApplicationStatus, DriverApplication } from '../../api/onboarding-types';
import { useLocale } from '../../i18n/LocaleProvider';
import { flaggedItems } from '../../onboarding/application';
import { formatDateTime } from '../../onboarding/dates';
import { colors, spacing } from '../../theme/tokens';
import { PrimaryButton } from '../auth/ui';
import { Card, Muted, NoteBox, SecondaryButton, SectionTitle, StatusChip, useRowStyle, useTextAlign } from './ui';
import type { ChipTone } from './ui';

export const STATUS_TONES: Record<ApplicationStatus, ChipTone> = {
  submitted: 'info',
  under_review: 'info',
  needs_changes: 'warning',
  approved: 'success',
  rejected: 'danger',
};

/**
 * UC-D-03 — the stage tracker: current stage, what happens next, flagged
 * items with the reviewer's notes, the rejection reason, and the history.
 */
export function ApplicationTracker({
  application,
  onRefresh,
  refreshing,
  onContinueApproved,
  approvedBusy,
}: {
  application: DriverApplication;
  onRefresh: () => void;
  refreshing: boolean;
  /** Re-reads /users/me so the activated driver role unlocks driver home. */
  onContinueApproved: () => void;
  approvedBusy: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language } = useLocale();
  const textAlign = useTextAlign();
  const rowStyle = useRowStyle();
  const { status } = application;
  const tone = STATUS_TONES[status];
  const flagged = status === 'needs_changes' ? flaggedItems(application) : null;

  return (
    <View testID={`tracker-${status}`}>
      <Card
        tone={tone === 'info' || tone === 'neutral' ? undefined : tone}
        testID="tracker-status"
      >
        <View style={[rowStyle, styles.statusHeader]}>
          <SectionTitle>{t('onboarding.tracker.currentStage')}</SectionTitle>
          <StatusChip
            label={t(`onboarding.status.${status}.label`)}
            tone={tone}
            testID="tracker-status-chip"
          />
        </View>
        <Text style={[styles.body, { textAlign }]} testID="tracker-status-body">
          {t(`onboarding.status.${status}.next`)}
        </Text>
        <Muted>
          {t('onboarding.tracker.submittedAt', {
            date: formatDateTime(application.submittedAt, language),
          })}
        </Muted>
      </Card>

      {flagged ? (
        <Card testID="tracker-flagged">
          <SectionTitle>{t('onboarding.tracker.flaggedTitle')}</SectionTitle>
          <Muted>{t('onboarding.tracker.flaggedHint')}</Muted>
          {flagged.personal ? (
            <NoteBox
              title={t('onboarding.steps.personal')}
              note={application.personal.reviewNote ?? ''}
              testID="flagged-personal"
            />
          ) : null}
          {flagged.documents.map((document) => (
            <NoteBox
              key={document.type}
              title={t(`onboarding.documentTypes.${document.type}`)}
              note={document.reviewNote ?? ''}
              testID={`flagged-${document.type}`}
            />
          ))}
          {flagged.vehicle ? (
            <NoteBox
              title={t('onboarding.steps.vehicle')}
              note={application.vehicle.reviewNote ?? ''}
              testID="flagged-vehicle"
            />
          ) : null}
          <PrimaryButton
            title={t('onboarding.tracker.fixItems')}
            onPress={() => router.push('/application-resubmit')}
            testID="tracker-fix"
          />
        </Card>
      ) : null}

      {status === 'rejected' ? (
        <Card testID="tracker-rejected-card">
          {application.rejectionReason ? (
            <NoteBox
              title={t('onboarding.tracker.rejectionReason')}
              note={application.rejectionReason}
              testID="tracker-rejection-reason"
            />
          ) : null}
          <Muted>{t('onboarding.tracker.reapplyHint')}</Muted>
          <PrimaryButton
            title={t('onboarding.tracker.reapply')}
            onPress={() => router.push('/driver-application')}
            testID="tracker-reapply"
          />
        </Card>
      ) : null}

      {status === 'approved' ? (
        <Card tone="success" testID="tracker-approved-card">
          <Muted>{t('onboarding.tracker.approvedHint')}</Muted>
          <PrimaryButton
            title={t('onboarding.tracker.openHome')}
            onPress={onContinueApproved}
            busy={approvedBusy}
            testID="tracker-open-home"
          />
        </Card>
      ) : null}

      <Card testID="tracker-history">
        <SectionTitle>{t('onboarding.tracker.history')}</SectionTitle>
        {application.history.map((event, index) => (
          <View key={`${event.at}-${index}`} style={styles.event} testID={`history-${index}`}>
            <View style={[rowStyle, styles.eventHeader]}>
              <View style={styles.dot} />
              <Text style={styles.eventStatus}>
                {t(`onboarding.status.${event.toStatus}.label`)}
              </Text>
            </View>
            <Muted>{formatDateTime(event.at, language)}</Muted>
            {event.note ? (
              <Text style={[styles.eventNote, { textAlign }]}>{event.note}</Text>
            ) : null}
          </View>
        ))}
      </Card>

      <SecondaryButton
        title={t(refreshing ? 'onboarding.tracker.refreshing' : 'onboarding.tracker.refresh')}
        icon="refresh"
        onPress={onRefresh}
        disabled={refreshing}
        testID="tracker-refresh"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  statusHeader: { justifyContent: 'space-between', gap: spacing.sm },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  event: { gap: 2, paddingVertical: spacing.xs },
  eventHeader: { gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.purple700 },
  eventStatus: { color: colors.text, fontSize: 15, fontWeight: '600' },
  eventNote: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
});
