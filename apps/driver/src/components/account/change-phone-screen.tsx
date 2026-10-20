import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  phoneChangeComplete,
  phoneChangeStart,
  phoneChangeVerifyCurrent,
} from "../../api/auth";
import { OTP_PATTERN, PHONE_PATTERN } from "../../api/auth-types";
import { normalizePhone } from "../../api/phone";
import { useAuth } from "../../auth/AuthProvider";
import { errorKeyFor } from "../auth/error-key";
import {
  Banner,
  BodyText,
  FormScreen,
  PrimaryButton,
  TextButton,
  TextField,
} from "../ui";

type Step = "new-phone" | "current-code" | "new-code" | "done";

/**
 * UC-S-06 — 3-step phone change: declare the new phone, prove the
 * CURRENT phone with an OTP, then prove the NEW phone. A 410 at either
 * verify step means the whole flow restarts (nothing mutates, ES-02).
 */
export function ChangePhoneScreen() {
  const { t } = useTranslation();
  const { setUser } = useAuth();

  const [step, setStep] = useState<Step>("new-phone");
  const [newPhone, setNewPhone] = useState("");
  const [code, setCode] = useState("");
  const [fieldErrorKey, setFieldErrorKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const restart = () => {
    setStep("new-phone");
    setCode("");
    setFieldErrorKey(null);
    // Keep errorKey so the user sees why they were sent back.
  };

  const start = async () => {
    const trimmed = normalizePhone(newPhone);
    if (!PHONE_PATTERN.test(trimmed)) {
      setFieldErrorKey("auth.validation.phone");
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setBusy(true);
    try {
      await phoneChangeStart(trimmed);
      setCode("");
      setStep("current-code");
    } catch (error) {
      setErrorKey(errorKeyFor(error, {
          409: "account.phone.taken",
          // The SMS gateway could not send the code (UC-S-01 E4 copy).
          502: "auth.otp.sendFailed",
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const validCode = () => {
    if (!OTP_PATTERN.test(code.trim())) {
      setFieldErrorKey("auth.validation.code");
      return false;
    }
    setFieldErrorKey(null);
    return true;
  };

  const verifyCurrent = async () => {
    if (!validCode()) return;
    setErrorKey(null);
    setBusy(true);
    try {
      await phoneChangeVerifyCurrent(code.trim());
      setCode("");
      setStep("new-code");
    } catch (error) {
      const key = errorKeyFor(error, {
        400: "auth.otp.wrongCode",
        410: "account.phone.restart",
      });
      setErrorKey(key);
      if (key === "account.phone.restart") restart();
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!validCode()) return;
    setErrorKey(null);
    setBusy(true);
    try {
      const profile = await phoneChangeComplete(code.trim());
      await setUser(profile);
      setStep("done");
    } catch (error) {
      const key = errorKeyFor(error, {
        400: "auth.otp.wrongCode",
        410: "account.phone.restart",
      });
      setErrorKey(key);
      if (key === "account.phone.restart") restart();
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen
      title={t("account.phone.title")}
      testID={`change-phone-step-${step}`}
    >
      {errorKey ? (
        <Banner
          tone="danger"
          message={t(errorKey)}
          testID="change-phone-error"
        />
      ) : null}

      {step === "new-phone" ? (
        <>
          <TextField
            label={t("account.phone.newPhone")}
            placeholder={t("auth.fields.phonePlaceholder")}
            keyboardType="phone-pad"
            autoCapitalize="none"
            value={newPhone}
            onChangeText={setNewPhone}
            error={
              fieldErrorKey === "auth.validation.phone"
                ? t(fieldErrorKey)
                : null
            }
            testID="change-phone-new"
          />
          <PrimaryButton
            title={t("account.phone.startCta")}
            onPress={start}
            busy={busy}
            testID="change-phone-start"
          />
        </>
      ) : null}

      {step === "current-code" ? (
        <>
          <BodyText testID="change-phone-current-hint">
            {t("account.phone.currentCodeHint")}
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
            testID="change-phone-current-code"
          />
          <PrimaryButton
            title={t("account.phone.verifyCta")}
            onPress={verifyCurrent}
            busy={busy}
            testID="change-phone-verify-current"
          />
        </>
      ) : null}

      {step === "new-code" ? (
        <>
          <BodyText testID="change-phone-new-hint">
            {t("account.phone.newCodeHint")}
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
            testID="change-phone-new-code"
          />
          <PrimaryButton
            title={t("account.phone.verifyCta")}
            onPress={complete}
            busy={busy}
            testID="change-phone-complete"
          />
        </>
      ) : null}

      {step === "done" ? (
        <>
          <Banner
            tone="success"
            message={t("account.phone.done")}
            testID="change-phone-done"
          />
          <TextButton
            title={t("account.phone.changeAgain")}
            onPress={() => {
              setNewPhone("");
              setErrorKey(null);
              restart();
            }}
            testID="change-phone-again"
          />
        </>
      ) : null}
    </FormScreen>
  );
}
