import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  NAME_MAX_LENGTH,
  updateProfile,
  uploadProfilePhoto,
} from '../../api/auth';
import { ApiError } from '../../api/http-client';
import { useAuth } from '../../auth/auth-context';
import { Button, ErrorBanner, FormField, SuccessBanner } from '../../components/form';
import { type AppLocale, SUPPORTED_LOCALES } from '../../i18n/translations';
import { useLocale } from '../../i18n/locale-context';
import { ScreenScrollView } from '../../components/screen';
import { colors, fontSize, radius, spacing } from '../../theme/tokens';

const LOCALE_LABEL_KEY: Record<AppLocale, string> = {
  en: 'settings.english',
  ar: 'settings.arabic',
};

/**
 * UC-S-09 — Edit profile (name + photo) and UC-S-10 — language.
 * The language switch is applied instantly (local) exactly like the
 * settings screen; Save persists name+language to the account.
 * Photo: pick with expo-image-picker → PUT multipart → updated profile.
 */
export default function ProfileEditScreen() {
  const { t, isRTL, setLocale, flipRows } = useLocale();
  const { user, setUser } = useAuth();

  const [name, setName] = useState(user?.name ?? '');
  const [language, setLanguage] = useState<AppLocale>(user?.language ?? 'en');
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const switchLanguage = async (next: AppLocale) => {
    setLanguage(next);
    await setLocale(next); // instant, as everywhere else
  };

  const save = async () => {
    const trimmed = name.trim();
    const nameOk = trimmed.length > 0 && trimmed.length <= NAME_MAX_LENGTH;
    setNameError(nameOk ? null : t('register.nameInvalid'));
    if (!nameOk) {
      return;
    }
    setBusy(true);
    setServerError(null);
    setSaved(false);
    try {
      const updated = await updateProfile({ name: trimmed, language });
      setUser(updated);
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.body?.message) {
        setServerError(error.body.message);
      } else if (error instanceof ApiError) {
        setServerError(t('profile.saveFailed'));
      } else {
        setServerError(t('common.networkError'));
      }
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async () => {
    setPhotoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    const asset = result.assets[0];
    setPhotoBusy(true);
    try {
      const updated = await uploadProfilePhoto({
        uri: asset.uri,
        name: asset.fileName ?? 'profile.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      });
      setUser(updated);
    } catch (error) {
      // UC-S-09 exception: invalid image type/size → rejected with reason.
      if (error instanceof ApiError && error.status === 400) {
        setPhotoError(error.body?.message ?? t('profile.photoUploadFailed'));
      } else {
        setPhotoError(t('common.networkError'));
      }
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <ScreenScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      testID="profile-edit-screen"
    >
      <View style={styles.photoSection}>
        <Text style={[styles.sectionTitle, isRTL && styles.textRtl]}>{t('profile.photo')}</Text>
        {user?.photoUrl ? (
          <Image source={{ uri: user.photoUrl }} style={styles.photo} testID="profile-photo" />
        ) : (
          <View style={[styles.photo, styles.photoFallback]} testID="profile-photo-fallback">
            <Text style={styles.photoInitial}>{(user?.name ?? '?').trim().charAt(0)}</Text>
          </View>
        )}
        <Button
          variant="secondary"
          label={t('profile.changePhoto')}
          onPress={() => void pickPhoto()}
          loading={photoBusy}
          testID="profile-change-photo"
        />
        {photoError ? <ErrorBanner message={photoError} testID="profile-photo-error" /> : null}
      </View>

      {serverError ? <ErrorBanner message={serverError} testID="profile-server-error" /> : null}
      {saved ? <SuccessBanner message={t('profile.saved')} testID="profile-saved" /> : null}

      <FormField
        label={t('register.nameLabel')}
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX_LENGTH}
        error={nameError}
        testID="profile-name"
      />

      <Text style={[styles.sectionTitle, isRTL && styles.textRtl]}>{t('settings.language')}</Text>
      <View style={[styles.row, flipRows && styles.rowRtl]}>
        {SUPPORTED_LOCALES.map((candidate) => {
          const selected = candidate === language;
          return (
            <Pressable
              key={candidate}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`profile-language-${candidate}`}
              style={[styles.languageButton, selected && styles.languageButtonSelected]}
              onPress={() => void switchLanguage(candidate)}
            >
              <Text style={[styles.languageLabel, selected && styles.languageLabelSelected]}>
                {t(LOCALE_LABEL_KEY[candidate])}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Button label={t('common.save')} onPress={save} loading={busy} testID="profile-save" />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bgLight,
  },
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  photoSection: {
    alignItems: 'center',
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    alignSelf: 'stretch',
  },
  photo: {
    width: 112,
    height: 112,
    borderRadius: radius.pill,
  },
  photoFallback: {
    backgroundColor: colors.lavender100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: {
    color: colors.purple700,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  languageButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lavender200,
    backgroundColor: colors.lavender100,
  },
  languageButtonSelected: {
    backgroundColor: colors.purple700,
    borderColor: colors.purple700,
  },
  languageLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  languageLabelSelected: {
    color: colors.white,
  },
});
