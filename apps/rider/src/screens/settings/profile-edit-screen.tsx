import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import {
  NAME_MAX_LENGTH,
  updateProfile,
  uploadProfilePhoto,
} from "../../api/auth";
import { ApiError } from "../../api/http-client";
import { useAuth } from "../../auth/auth-context";
import {
  AppText,
  Banner,
  ChoiceChip,
  PrimaryButton,
  ScreenScrollView,
  screenStyles,
  SecondaryButton,
  TextField,
  useDirection,
} from "../../components/ui";
import { type AppLocale, SUPPORTED_LOCALES } from "../../i18n/translations";
import { reloadIfDirectionChanged, useLocale } from "../../i18n/locale-context";
import { colors, radius, spacing } from "../../theme/tokens";

const LOCALE_LABEL_KEY: Record<AppLocale, string> = {
  en: "settings.english",
  ar: "settings.arabic",
};

/**
 * UC-S-09 — Edit profile (name + photo) and UC-S-10 — language.
 * The language switch is applied instantly (local) exactly like the
 * settings screen; Save persists name+language to the account.
 * Photo: pick with expo-image-picker → PUT multipart → updated profile.
 */
export default function ProfileEditScreen() {
  const { t, locale, setLocale } = useLocale();
  const { row } = useDirection();
  const { user, setUser } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [language, setLanguage] = useState<AppLocale>(user?.language ?? "en");
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Applied on save: a direction change reloads the app, which would
  // otherwise drop unsaved edits.
  const switchLanguage = (next: AppLocale) => {
    setLanguage(next);
  };

  const save = async () => {
    const trimmed = name.trim();
    const nameOk = trimmed.length > 0 && trimmed.length <= NAME_MAX_LENGTH;
    setNameError(nameOk ? null : t("register.nameInvalid"));
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
      if (updated.language !== locale) {
        await setLocale(updated.language);
        await reloadIfDirectionChanged(updated.language, "/settings");
      }
    } catch (error) {
      // Server messages are English-only (M15-T4): show the localized copy instead.
      if (error instanceof ApiError) {
        setServerError(t("profile.saveFailed"));
      } else {
        setServerError(t("common.networkError"));
      }
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async () => {
    setPhotoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
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
        name: asset.fileName ?? "profile.jpg",
        type: asset.mimeType ?? "image/jpeg",
      });
      setUser(updated);
    } catch (error) {
      // UC-S-09 exception: invalid image type/size → rejected with reason.
      if (error instanceof ApiError && error.status === 400) {
        setPhotoError(t("profile.photoUploadFailed"));
      } else {
        setPhotoError(t("common.networkError"));
      }
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      keyboardShouldPersistTaps="handled"
      testID="profile-edit-screen"
    >
      <View style={styles.photoSection}>
        <AppText variant="label" tone="secondary" style={styles.stretch}>
          {t("profile.photo")}
        </AppText>
        {user?.photoUrl ? (
          <Image
            source={{ uri: user.photoUrl }}
            style={styles.photo}
            testID="profile-photo"
          />
        ) : (
          <View
            style={[styles.photo, styles.photoFallback]}
            testID="profile-photo-fallback"
          >
            <AppText variant="display" tone="accent" align="center">
              {(user?.name ?? "?").trim().charAt(0)}
            </AppText>
          </View>
        )}
        <SecondaryButton
          label={t("profile.changePhoto")}
          onPress={() => void pickPhoto()}
          loading={photoBusy}
          testID="profile-change-photo"
        />
        {photoError ? (
          <Banner
            tone="danger"
            message={photoError}
            testID="profile-photo-error"
          />
        ) : null}
      </View>

      {serverError ? (
        <Banner
          tone="danger"
          message={serverError}
          testID="profile-server-error"
        />
      ) : null}
      {saved ? (
        <Banner
          tone="success"
          message={t("profile.saved")}
          testID="profile-saved"
        />
      ) : null}

      <TextField
        label={t("register.nameLabel")}
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX_LENGTH}
        error={nameError}
        testID="profile-name"
      />

      <View style={styles.group}>
        <AppText variant="label" tone="secondary">
          {t("settings.language")}
        </AppText>
        <View style={[styles.row, { flexDirection: row }]}>
          {SUPPORTED_LOCALES.map((candidate) => (
            <ChoiceChip
              key={candidate}
              label={t(LOCALE_LABEL_KEY[candidate])}
              selected={candidate === language}
              onPress={() => switchLanguage(candidate)}
              testID={`profile-language-${candidate}`}
              style={styles.choice}
            />
          ))}
        </View>
      </View>

      <PrimaryButton
        label={t("common.save")}
        onPress={save}
        loading={busy}
        testID="profile-save"
      />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  photoSection: {
    alignItems: "center",
    gap: spacing.lg,
  },
  stretch: {
    alignSelf: "stretch",
  },
  photo: {
    width: 112,
    height: 112,
    borderRadius: radius.round,
  },
  photoFallback: {
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  group: {
    gap: spacing.sm,
  },
  row: {
    gap: spacing.sm,
  },
  choice: {
    flex: 1,
  },
});
