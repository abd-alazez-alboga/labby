import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { updateMyProfile, uploadMyPhoto } from '../../api/auth';
import { useAuth } from '../../auth/AuthProvider';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import type { Language } from '../../i18n';
import { useLocale } from '../../i18n/LocaleProvider';
import { colors, radius, spacing } from '../../theme/tokens';
import {
  BodyText,
  ErrorBanner,
  Field,
  FormScreen,
  InfoBanner,
  PrimaryButton,
  TextButton,
  errorKeyFor,
} from '../auth/ui';

const LANGUAGE_LABEL_KEYS: Record<Language, string> = {
  en: 'settings.english',
  ar: 'settings.arabic',
};

/**
 * UC-S-09 / UC-S-10 — edit name + language (PUT /users/me) and the
 * profile photo (expo-image-picker -> PUT multipart /users/me/photo).
 * Language saved to the account is also applied locally.
 */
export function ProfileEditScreen() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const { language: appLanguage, direction, setLanguage: setAppLanguage } =
    useLocale();
  const textAlign = direction === 'rtl' ? 'right' : 'left';

  const [name, setName] = useState(user?.name ?? '');
  const [language, setLanguage] = useState<Language>(
    user?.language ?? appLanguage,
  );
  const [fieldErrorKey, setFieldErrorKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  const save = async () => {
    if (name.trim().length === 0) {
      setFieldErrorKey('auth.validation.name');
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setInfoKey(null);
    setBusy(true);
    try {
      const profile = await updateMyProfile({ name: name.trim(), language });
      await setUser(profile);
      if (profile.language !== appLanguage) {
        await setAppLanguage(profile.language);
      }
      setInfoKey('account.profile.saved');
    } catch (error) {
      setErrorKey(errorKeyFor(error, {}));
    } finally {
      setBusy(false);
    }
  };

  const choosePhoto = async () => {
    setErrorKey(null);
    setInfoKey(null);
    setPhotoBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) {
        return;
      }
      const asset = result.assets[0];
      const profile = await uploadMyPhoto({
        uri: asset.uri,
        fileName: asset.fileName ?? 'profile-photo.jpg',
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      await setUser(profile);
      setInfoKey('account.profile.photoSet');
    } catch (error) {
      setErrorKey(errorKeyFor(error, { 400: 'account.profile.photoError' }));
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <FormScreen testID="profile-edit-screen">
      {errorKey ? (
        <ErrorBanner testID="profile-error">{t(errorKey)}</ErrorBanner>
      ) : null}
      {infoKey ? (
        <InfoBanner testID="profile-info">{t(infoKey)}</InfoBanner>
      ) : null}

      <Field
        label={t('auth.fields.name')}
        value={name}
        onChangeText={setName}
        maxLength={100}
        error={
          fieldErrorKey === 'auth.validation.name' ? t(fieldErrorKey) : null
        }
        testID="profile-name"
      />

      <Text style={[styles.sectionLabel, { textAlign }]}>
        {t('account.profile.language')}
      </Text>
      <View style={styles.optionsRow}>
        {SUPPORTED_LANGUAGES.map((option) => {
          const selected = option === language;
          return (
            <Pressable
              key={option}
              testID={`profile-language-${option}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setLanguage(option)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text
                style={[
                  styles.optionText,
                  selected && styles.optionTextSelected,
                ]}
              >
                {t(LANGUAGE_LABEL_KEYS[option])}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <PrimaryButton
        title={t('account.profile.save')}
        onPress={save}
        busy={busy}
        testID="profile-save"
      />

      <Text style={[styles.sectionLabel, { textAlign }]}>
        {t('account.profile.photo')}
      </Text>
      {user?.photoUrl ? (
        <BodyText testID="profile-photo-on-file">
          {t('account.profile.photoOnFile')}
        </BodyText>
      ) : null}
      <TextButton
        title={t('account.profile.choosePhoto')}
        onPress={choosePhoto}
        disabled={photoBusy}
        testID="profile-choose-photo"
      />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  option: {
    flex: 1,
    backgroundColor: colors.white,
    borderColor: colors.lilac200,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  optionSelected: {
    backgroundColor: colors.purple700,
    borderColor: colors.purple700,
  },
  optionText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: colors.white,
  },
});
