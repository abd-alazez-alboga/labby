import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { updateMyProfile, uploadMyPhoto } from "../../api/auth";
import { useAuth } from "../../auth/AuthProvider";
import { SUPPORTED_LANGUAGES } from "../../i18n";
import type { Language } from "../../i18n";
import { useLocale } from "../../i18n/LocaleProvider";
import { errorKeyFor } from "../auth/error-key";
import {
  Banner,
  BodyText,
  FieldLabel,
  FormScreen,
  OptionGroup,
  PrimaryButton,
  TextButton,
  TextField,
} from "../ui";

const LANGUAGE_LABEL_KEYS: Record<Language, string> = {
  en: "settings.english",
  ar: "settings.arabic",
};

/**
 * UC-S-09 / UC-S-10 — edit name + language (PUT /users/me) and the
 * profile photo (expo-image-picker -> PUT multipart /users/me/photo).
 * Language saved to the account is also applied locally.
 */
export function ProfileEditScreen() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const { language: appLanguage, setLanguage: setAppLanguage } = useLocale();

  const [name, setName] = useState(user?.name ?? "");
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
      setFieldErrorKey("auth.validation.name");
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
        await setAppLanguage(profile.language, { returnTo: "/settings" });
      }
      setInfoKey("account.profile.saved");
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
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) {
        return;
      }
      const asset = result.assets[0];
      const profile = await uploadMyPhoto({
        uri: asset.uri,
        fileName: asset.fileName ?? "profile-photo.jpg",
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      await setUser(profile);
      setInfoKey("account.profile.photoSet");
    } catch (error) {
      setErrorKey(errorKeyFor(error, { 400: "account.profile.photoError" }));
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <FormScreen title={t("account.profile.title")} testID="profile-edit-screen">
      {errorKey ? (
        <Banner tone="danger" message={t(errorKey)} testID="profile-error" />
      ) : null}
      {infoKey ? (
        <Banner tone="success" message={t(infoKey)} testID="profile-info" />
      ) : null}

      <TextField
        label={t("auth.fields.name")}
        value={name}
        onChangeText={setName}
        maxLength={100}
        error={
          fieldErrorKey === "auth.validation.name" ? t(fieldErrorKey) : null
        }
        testID="profile-name"
      />

      <FieldLabel>{t("account.profile.language")}</FieldLabel>
      <OptionGroup
        options={SUPPORTED_LANGUAGES}
        value={language}
        onChange={setLanguage}
        labelFor={(option) => t(LANGUAGE_LABEL_KEYS[option])}
        testIDPrefix="profile-language"
      />

      <PrimaryButton
        title={t("account.profile.save")}
        onPress={save}
        busy={busy}
        testID="profile-save"
      />

      <FieldLabel>{t("account.profile.photo")}</FieldLabel>
      {user?.photoUrl ? (
        <BodyText testID="profile-photo-on-file">
          {t("account.profile.photoOnFile")}
        </BodyText>
      ) : null}
      <TextButton
        title={t("account.profile.choosePhoto")}
        onPress={choosePhoto}
        disabled={photoBusy}
        testID="profile-choose-photo"
      />
    </FormScreen>
  );
}
