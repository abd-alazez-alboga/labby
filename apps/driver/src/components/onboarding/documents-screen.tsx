import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { getMyDocuments } from '../../api/onboarding';
import type { DocumentSlot } from '../../api/onboarding-types';
import { DOCUMENT_TYPES } from '../../api/onboarding-types';
import { useLocale } from '../../i18n/LocaleProvider';
import { formatDate } from '../../onboarding/dates';
import { useRemote } from '../../onboarding/use-remote';
import { colors, spacing } from '../../theme/tokens';
import { BodyText, ErrorBanner } from '../auth/ui';
import {
  Card,
  FailureState,
  KeyValue,
  LoadingState,
  Muted,
  NoteBox,
  SecondaryButton,
  SectionTitle,
  StatusChip,
  useRowStyle,
} from './ui';

const NOT_APPROVED = [409] as const;

function SlotCard({ slot }: { slot: DocumentSlot }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language } = useLocale();
  const rowStyle = useRowStyle();
  const { current, renewal } = slot;
  const pending = renewal?.reviewStatus === 'pending';
  const rejected = renewal?.reviewStatus === 'rejected';

  return (
    <Card tone={slot.expired ? 'danger' : undefined} testID={`slot-${slot.type}`}>
      <View style={[rowStyle, styles.header]}>
        <SectionTitle>{t(`onboarding.documentTypes.${slot.type}`)}</SectionTitle>
        {slot.expired ? (
          <StatusChip
            label={t('onboarding.documents.expired')}
            tone="danger"
            testID={`slot-${slot.type}-expired`}
          />
        ) : (
          <StatusChip label={t('onboarding.documents.valid')} tone="success" />
        )}
      </View>
      <KeyValue label={t('onboarding.document.number')} value={current.number} />
      <KeyValue
        label={t(slot.expired ? 'onboarding.documents.expiredOn' : 'onboarding.documents.validThrough')}
        value={formatDate(current.expiresOn, language)}
      />
      {pending && renewal ? (
        <View style={styles.renewal} testID={`slot-${slot.type}-pending`}>
          <StatusChip label={t('onboarding.documents.renewalPending')} tone="warning" />
          <Muted>
            {t('onboarding.documents.renewalPendingHint', {
              date: formatDate(renewal.expiresOn, language),
            })}
          </Muted>
        </View>
      ) : null}
      {rejected && renewal ? (
        <NoteBox
          title={t('onboarding.documents.renewalRejected')}
          note={renewal.reviewNote ?? t('onboarding.documents.noReason')}
          testID={`slot-${slot.type}-rejected`}
        />
      ) : null}
      <SecondaryButton
        title={t('onboarding.documents.renew')}
        icon="refresh-circle-outline"
        disabled={pending}
        onPress={() =>
          router.push({ pathname: '/renew-document', params: { type: slot.type } })
        }
        testID={`slot-${slot.type}-renew`}
      />
    </Card>
  );
}

/**
 * UC-D-19 — the four current documents with expiry and renewal state; the
 * entry point for renewing (also from the expiry-suspension state).
 */
export function DocumentsScreen() {
  const { t } = useTranslation();
  const { state, refreshing, reload } = useRemote(getMyDocuments, NOT_APPROVED);

  const ordered =
    state.status === 'loaded'
      ? [...state.data].sort(
          (a, b) => DOCUMENT_TYPES.indexOf(a.type) - DOCUMENT_TYPES.indexOf(b.type),
        )
      : [];
  const anyExpired = ordered.some((slot) => slot.expired);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />
      }
      testID="documents-screen"
    >
      {state.status === 'loading' ? <LoadingState /> : null}
      {state.status === 'error' ? (
        <FailureState kind={state.kind} onRetry={() => void reload()} />
      ) : null}
      {state.status === 'absent' ? (
        <BodyText testID="documents-not-approved">
          {t('onboarding.documents.notApproved')}
        </BodyText>
      ) : null}
      {state.status === 'loaded' ? (
        <>
          <BodyText>{t('onboarding.documents.intro')}</BodyText>
          {anyExpired ? (
            <ErrorBanner testID="documents-expired-banner">
              {t('onboarding.documents.expiredBanner')}
            </ErrorBanner>
          ) : null}
          {ordered.map((slot) => (
            <SlotCard key={slot.type} slot={slot} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgLight },
  content: { padding: spacing.lg, gap: spacing.sm },
  header: { justifyContent: 'space-between', gap: spacing.sm },
  renewal: { gap: spacing.xs },
});
