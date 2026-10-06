import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { uploadMyPhoto } from '../../api/auth';
import { ApiError } from '../../api/client';
import { resolveFileUrl } from '../../api/onboarding';
import {
  DOCUMENT_NUMBER_MAX,
  PROFILE_NAME_MAX,
  VEHICLE_COLOR_MAX,
  VEHICLE_PLATE_MAX,
  VEHICLE_TEXT_MAX,
} from '../../api/onboarding-types';
import { useAuth } from '../../auth/AuthProvider';
import type {
  DocumentDraft,
  DocumentField,
  FieldErrors,
  PickedFile,
  VehicleDraft,
  VehicleField,
} from '../../onboarding/drafts';
import { pickFile } from '../../onboarding/file-picking';
import type { PickSource } from '../../onboarding/file-picking';
import { documentFieldError, documentLevelError, messageKeyFor } from '../../onboarding/server-errors';
import type { ServerFieldErrors } from '../../onboarding/server-errors';
import { colors, radius, spacing } from '../../theme/tokens';
import { CheckboxRow, Field } from '../auth/ui';
import { DocumentFileField, VehiclePhotosField } from './file-fields';
import { DateField, FieldError, Muted, NoteBox, SecondaryButton, useTextAlign } from './ui';

/**
 * The wizard's step bodies. Each renders ONE concern; validation results
 * (client keys first, then mapped server errors) arrive as props.
 */

function pickError(
  t: (key: string) => string,
  clientKey: string | undefined,
  serverKey: string | null,
): string | null {
  if (clientKey) return t(clientKey);
  return serverKey ? t(serverKey) : null;
}

// ------------------------------------------------------------- personal

export interface PersonalStepProps {
  name: string;
  onNameChange: (name: string) => void;
  nameErrorKey?: string | null;
  photoErrorKey?: string | null;
  onPhotoChanged: () => void;
  note?: string | null;
  confirm?: { checked: boolean; onToggle: () => void; errorKey?: string | null };
}

/** Personal details = account name + REQUIRED profile photo (owner ruling). */
export function PersonalStep({
  name,
  onNameChange,
  nameErrorKey,
  photoErrorKey,
  onPhotoChanged,
  note,
  confirm,
}: PersonalStepProps) {
  const { t } = useTranslation();
  const textAlign = useTextAlign();
  const { user, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [uploadErrorKey, setUploadErrorKey] = useState<string | null>(null);

  const choosePhoto = async (source: PickSource) => {
    setUploadErrorKey(null);
    setBusy(true);
    try {
      const picked = await pickFile('vehicle_photo', source);
      if (picked.status === 'canceled') return;
      if (picked.status === 'invalid') {
        setUploadErrorKey(picked.errorKey);
        return;
      }
      const profile = await uploadMyPhoto({
        uri: picked.file.uri,
        fileName: picked.file.name,
        mimeType: picked.file.mimeType,
      });
      await setUser(profile);
      onPhotoChanged();
    } catch (error) {
      setUploadErrorKey(
        error instanceof ApiError
          ? error.status === 400
            ? 'account.profile.photoError'
            : 'onboarding.errors.server'
          : 'onboarding.errors.network',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="step-personal">
      {note ? <NoteBox title={t('onboarding.reviewerNote')} note={note} testID="step-note" /> : null}
      <Muted>{t('onboarding.personal.hint')}</Muted>
      <Field
        label={t('auth.fields.name')}
        value={name}
        onChangeText={onNameChange}
        maxLength={PROFILE_NAME_MAX}
        error={nameErrorKey ? t(nameErrorKey) : null}
        testID="personal-name"
      />
      <Text style={[styles.label, { textAlign }]}>{t('onboarding.personal.photo')}</Text>
      <Muted>{t('onboarding.personal.photoHint')}</Muted>
      {user?.photoUrl ? (
        <View style={styles.avatarWrap} testID="personal-photo-on-file">
          <Image
            source={{ uri: resolveFileUrl(user.photoUrl) }}
            style={styles.avatar}
            accessibilityLabel={t('onboarding.personal.photo')}
          />
        </View>
      ) : (
        <Muted testID="personal-photo-missing">{t('onboarding.personal.noPhoto')}</Muted>
      )}
      {busy ? (
        <View style={styles.busy} testID="personal-photo-uploading">
          <ActivityIndicator color={colors.purple700} />
          <Text style={styles.busyText}>{t('onboarding.file.uploading')}</Text>
        </View>
      ) : (
        <View style={styles.sources}>
          <SecondaryButton
            title={t('onboarding.file.source.camera')}
            icon="camera-outline"
            onPress={() => void choosePhoto('camera')}
            testID="personal-photo-camera"
          />
          <SecondaryButton
            title={t('onboarding.file.source.library')}
            icon="images-outline"
            onPress={() => void choosePhoto('library')}
            testID="personal-photo-library"
          />
        </View>
      )}
      {uploadErrorKey ? (
        <FieldError testID="personal-photo-upload-error">{t(uploadErrorKey)}</FieldError>
      ) : photoErrorKey ? (
        <FieldError testID="personal-photo-error">{t(photoErrorKey)}</FieldError>
      ) : null}
      {confirm ? (
        <CheckboxRow
          label={t('onboarding.personal.confirm')}
          checked={confirm.checked}
          onToggle={confirm.onToggle}
          error={confirm.errorKey ? t(confirm.errorKey) : null}
          testID="personal-confirm"
        />
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------- document

export function DocumentStep({
  draft,
  onChange,
  errors,
  serverErrors,
  scope,
  note,
  testID,
}: {
  draft: DocumentDraft;
  onChange: (draft: DocumentDraft, field: DocumentField) => void;
  errors: FieldErrors<DocumentField>;
  serverErrors: ServerFieldErrors;
  /** fieldErrors key prefix: `documents[type]`, or '' for a renewal body. */
  scope: string;
  note?: string | null;
  testID: string;
}) {
  const { t } = useTranslation();
  const whole = documentLevelError(serverErrors, scope);
  return (
    <View testID={testID}>
      {note ? <NoteBox title={t('onboarding.reviewerNote')} note={note} testID="step-note" /> : null}
      <Muted>{t(`onboarding.documentHints.${draft.type}`)}</Muted>
      {whole ? <FieldError testID={`${testID}-server-error`}>{t(whole)}</FieldError> : null}
      <DocumentFileField
        value={draft.file}
        onChange={(file: PickedFile) => onChange({ ...draft, file }, 'file')}
        error={pickError(t, errors.file, documentFieldError(serverErrors, scope, 'fileId'))}
        testID="document-file"
      />
      <Field
        label={t('onboarding.document.number')}
        value={draft.number}
        onChangeText={(number) => onChange({ ...draft, number }, 'number')}
        maxLength={DOCUMENT_NUMBER_MAX}
        autoCapitalize="characters"
        error={pickError(t, errors.number, documentFieldError(serverErrors, scope, 'number'))}
        testID="document-number"
      />
      <DateField
        label={t('onboarding.document.expiresOn')}
        value={draft.expiresOn}
        onChange={(expiresOn) => onChange({ ...draft, expiresOn }, 'expiresOn')}
        error={pickError(
          t,
          errors.expiresOn,
          documentFieldError(serverErrors, scope, 'expiresOn'),
        )}
        testID="document-expiry"
      />
      <Muted>{t('onboarding.document.expiryHint')}</Muted>
    </View>
  );
}

// -------------------------------------------------------------- vehicle

const VEHICLE_FIELDS: {
  field: VehicleField;
  max: number;
  numeric?: boolean;
  capitalize?: 'characters' | 'words';
}[] = [
  { field: 'make', max: VEHICLE_TEXT_MAX, capitalize: 'words' },
  { field: 'model', max: VEHICLE_TEXT_MAX, capitalize: 'words' },
  { field: 'year', max: 4, numeric: true },
  { field: 'color', max: VEHICLE_COLOR_MAX },
  { field: 'plate', max: VEHICLE_PLATE_MAX, capitalize: 'characters' },
  { field: 'seats', max: 1, numeric: true },
];

export function VehicleDetailsStep({
  draft,
  onChange,
  errors,
  serverErrors,
  note,
}: {
  draft: VehicleDraft;
  onChange: (draft: VehicleDraft, field: VehicleField) => void;
  errors: FieldErrors<VehicleField>;
  serverErrors: ServerFieldErrors;
  note?: string | null;
}) {
  const { t } = useTranslation();
  const whole = 'vehicle' in serverErrors ? 'onboarding.server.generic' : null;
  return (
    <View testID="step-vehicle">
      {note ? <NoteBox title={t('onboarding.reviewerNote')} note={note} testID="step-note" /> : null}
      <Muted>{t('onboarding.vehicle.hint')}</Muted>
      {whole ? <FieldError testID="vehicle-server-error">{t(whole)}</FieldError> : null}
      {VEHICLE_FIELDS.map(({ field, max, numeric, capitalize }) => {
        const serverKey = `vehicle.${field}`;
        return (
          <Field
            key={field}
            label={t(`onboarding.vehicle.${field}`)}
            value={draft[field]}
            onChangeText={(value) => onChange({ ...draft, [field]: value }, field)}
            maxLength={max}
            keyboardType={numeric ? 'number-pad' : 'default'}
            autoCapitalize={capitalize ?? 'sentences'}
            placeholder={
              field === 'seats' ? t('onboarding.vehicle.seatsPlaceholder') : undefined
            }
            error={pickError(
              t,
              errors[field],
              serverKey in serverErrors ? messageKeyFor(serverKey) : null,
            )}
            testID={`vehicle-${field}`}
          />
        );
      })}
    </View>
  );
}

export function VehiclePhotosStep({
  draft,
  onChange,
  errorKey,
  serverErrors,
  note,
}: {
  draft: VehicleDraft;
  onChange: (draft: VehicleDraft) => void;
  errorKey: string | null;
  serverErrors: ServerFieldErrors;
  note?: string | null;
}) {
  const { t } = useTranslation();
  const serverKey = Object.keys(serverErrors).find((key) =>
    key.startsWith('vehicle.photoFileIds'),
  );
  return (
    <View testID="step-photos">
      {note ? <NoteBox title={t('onboarding.reviewerNote')} note={note} testID="step-note" /> : null}
      <VehiclePhotosField
        value={draft.photos}
        onChange={(photos) => onChange({ ...draft, photos })}
        error={pickError(t, errorKey ?? undefined, serverKey ? messageKeyFor(serverKey) : null)}
        testID="vehicle-photos"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  avatarWrap: { alignItems: 'center', marginVertical: spacing.sm },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.lavender100,
    borderWidth: 2,
    borderColor: colors.lilac200,
  },
  busy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  busyText: { color: colors.textMuted, fontSize: 13 },
  sources: { gap: spacing.sm, marginVertical: spacing.sm, borderRadius: radius.md },
});
