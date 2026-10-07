import { useRouter } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorKeyFor } from "./error-key";
import { login } from "../../api/auth";
import { PHONE_PATTERN } from "../../api/auth-types";
import { useAuth } from "../../auth/AuthProvider";
import {
  Banner,
  FormScreen,
  PrimaryButton,
  TextButton,
  TextField,
} from "../ui";

/**
 * UC-S-02 — phone + password login (never OTP-gated, AUTH-05).
 * Sends client=driver; rider-only accounts still log in and hit the
 * in-app driver gate. 403 means no role valid for this client at all.
 */
export function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { applySession } = useAuth();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = phone.trim();
    if (!PHONE_PATTERN.test(trimmed)) {
      setFieldError("auth.validation.phone");
      return;
    }
    if (password.length === 0) {
      setFieldError("auth.validation.passwordRequired");
      return;
    }
    setFieldError(null);
    setErrorKey(null);
    setBusy(true);
    try {
      const tokens = await login(trimmed, password);
      await applySession(tokens);
      // Navigation happens via the auth guards in the root layout.
    } catch (error) {
      setErrorKey(
        errorKeyFor(error, {
          401: "auth.login.invalidCredentials",
          403: "auth.login.noRole",
          429: "auth.login.tooManyAttempts",
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen title={t("auth.login.title")} testID="login-screen">
      {errorKey ? (
        <Banner tone="danger" message={t(errorKey)} testID="login-error" />
      ) : null}
      <TextField
        label={t("auth.fields.phone")}
        placeholder={t("auth.fields.phonePlaceholder")}
        keyboardType="phone-pad"
        autoCapitalize="none"
        value={phone}
        onChangeText={setPhone}
        error={fieldError === "auth.validation.phone" ? t(fieldError) : null}
        testID="login-phone"
      />
      <TextField
        label={t("auth.fields.password")}
        secureTextEntry
        autoCapitalize="none"
        value={password}
        onChangeText={setPassword}
        error={
          fieldError === "auth.validation.passwordRequired"
            ? t(fieldError)
            : null
        }
        testID="login-password"
      />
      <PrimaryButton
        title={t("auth.login.submit")}
        onPress={submit}
        busy={busy}
        testID="login-submit"
      />
      <TextButton
        title={t("auth.login.forgot")}
        onPress={() => router.push("/forgot-password")}
        testID="login-forgot"
      />
      <TextButton
        title={t("auth.login.noAccount")}
        onPress={() => router.push("/register")}
        testID="login-register"
      />
    </FormScreen>
  );
}
