import { useRouter } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorKeyFor } from "./error-key";
import {
  Banner,
  BodyText,
  FormScreen,
  PrimaryButton,
  TextButton,
  TextField,
} from "../ui";
import { useCooldown } from "./use-cooldown";
import {
  passwordResetComplete,
  passwordResetStart,
  passwordResetVerify,
} from "../../api/auth";
import {
  OTP_PATTERN,
  OTP_RESEND_COOLDOWN_SECONDS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PHONE_PATTERN,
} from "../../api/auth-types";
import { normalizePhone } from "../../api/phone";

type Step = "phone" | "code" | "password" | "done";

/**
 * UC-S-04 — 3-step password reset. The start step always answers 204
 * (no account enumeration, NFR-S3), so the UI shows a neutral
 * "if this number is registered" message.
 */
export function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [fieldErrorKey, setFieldErrorKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();

  const sendCode = async (isResend: boolean) => {
    const trimmed = normalizePhone(phone);
    if (!PHONE_PATTERN.test(trimmed)) {
      setFieldErrorKey("auth.validation.phone");
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setBusy(true);
    try {
      await passwordResetStart(trimmed);
      cooldown.start(OTP_RESEND_COOLDOWN_SECONDS);
      setCode("");
      if (!isResend) setStep("code");
    } catch (error) {
      // The contract keeps this neutral (204 even on unknown phones);
      // anything else is a transport/server failure — 502 means the SMS
      // gateway could not send the code (UC-S-01 E4 copy).
      setErrorKey(errorKeyFor(error, { 502: "auth.otp.sendFailed" }));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!OTP_PATTERN.test(code.trim())) {
      setFieldErrorKey("auth.validation.code");
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setBusy(true);
    try {
      const result = await passwordResetVerify(normalizePhone(phone), code.trim());
      setResetToken(result.resetToken);
      setStep("password");
    } catch (error) {
      setErrorKey(
        errorKeyFor(error, {
          400: "auth.otp.wrongCode",
          410: "auth.otp.expired",
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (
      newPassword.length < PASSWORD_MIN_LENGTH ||
      newPassword.length > PASSWORD_MAX_LENGTH
    ) {
      setFieldErrorKey("auth.validation.password");
      return;
    }
    if (confirmPassword !== newPassword) {
      setFieldErrorKey("auth.validation.confirm");
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setBusy(true);
    try {
      await passwordResetComplete(resetToken, newPassword);
      setStep("done");
    } catch (error) {
      setErrorKey(errorKeyFor(error, { 400: "auth.reset.invalid" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen title={t("auth.reset.title")} testID={`reset-step-${step}`}>
      {errorKey ? (
        <Banner tone="danger" message={t(errorKey)} testID="reset-error" />
      ) : null}

      {step === "phone" ? (
        <>
          <TextField
            label={t("auth.fields.phone")}
            placeholder={t("auth.fields.phonePlaceholder")}
            keyboardType="phone-pad"
            autoCapitalize="none"
            value={phone}
            onChangeText={setPhone}
            error={
              fieldErrorKey === "auth.validation.phone"
                ? t(fieldErrorKey)
                : null
            }
            testID="reset-phone"
          />
          <PrimaryButton
            title={t("auth.reset.phoneCta")}
            onPress={() => sendCode(false)}
            busy={busy}
            testID="reset-send-code"
          />
        </>
      ) : null}

      {step === "code" ? (
        <>
          <BodyText testID="reset-neutral-note">
            {t("auth.reset.neutralSent")}
          </BodyText>
          <TextField
            label={t("auth.fields.code")}
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
            error={
              fieldErrorKey === "auth.validation.code" ? t(fieldErrorKey) : null
            }
            testID="reset-code"
          />
          <PrimaryButton
            title={t("auth.reset.verifyCta")}
            onPress={verifyCode}
            busy={busy}
            testID="reset-verify"
          />
          <TextButton
            title={
              cooldown.active
                ? t("auth.otp.resendIn", { seconds: cooldown.remaining })
                : t("auth.otp.resend")
            }
            onPress={() => sendCode(true)}
            disabled={cooldown.active || busy}
            testID="reset-resend"
          />
        </>
      ) : null}

      {step === "password" ? (
        <>
          <TextField
            label={t("auth.fields.newPassword")}
            secureTextEntry
            autoCapitalize="none"
            value={newPassword}
            onChangeText={setNewPassword}
            error={
              fieldErrorKey === "auth.validation.password"
                ? t(fieldErrorKey)
                : null
            }
            testID="reset-new-password"
          />
          <TextField
            label={t("auth.fields.confirmPassword")}
            secureTextEntry
            autoCapitalize="none"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={
              fieldErrorKey === "auth.validation.confirm"
                ? t(fieldErrorKey)
                : null
            }
            testID="reset-confirm-password"
          />
          <PrimaryButton
            title={t("auth.reset.completeCta")}
            onPress={complete}
            busy={busy}
            testID="reset-complete"
          />
        </>
      ) : null}

      {step === "done" ? (
        <>
          <Banner
            tone="success"
            message={t("auth.reset.doneTitle")}
            testID="reset-done"
          />
          <BodyText>{t("auth.reset.doneBody")}</BodyText>
          <PrimaryButton
            title={t("auth.login.title")}
            onPress={() => router.replace("/login")}
            testID="reset-go-login"
          />
        </>
      ) : null}
    </FormScreen>
  );
}
