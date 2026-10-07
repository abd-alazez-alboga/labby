import React, { useState } from "react";
import { StyleSheet, View } from "react-native";

import { deleteAccount, isValidOtp, request2faCode } from "../../api/auth";
import { ApiError } from "../../api/http-client";
import { useAuth } from "../../auth/auth-context";
import {
  Banner,
  DestructiveTextButton,
  ScreenScrollView,
  screenStyles,
  SecondaryButton,
  TextField,
} from "../../components/ui";
import { useCooldown } from "../../hooks/use-cooldown";
import { useLocale } from "../../i18n/locale-context";
import { spacing } from "../../theme/tokens";

/**
 * UC-S-07 — Delete account (2FA, soft). Shows the consequences first
 * (access ends, data retained, re-registration reactivates), verifies a
 * 2FA OTP, then soft-deletes. On 204 the user is signed out locally with
 * reason `deleted`, which drives the goodbye state on the welcome screen.
 * 409 — blocked by a precondition (active ride, unsettled balance).
 */
export default function DeleteAccountScreen() {
  const { t } = useLocale();
  const { signOutAfterDeletion } = useAuth();
  const cooldown = useCooldown();

  const [otpCode, setOtpCode] = useState("");
  const [otpFieldError, setOtpFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    setServerError(null);
    setCodeBusy(true);
    try {
      await request2faCode();
      setCodeSent(true);
      cooldown.start();
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setServerError(t("auth.otpHourlyCap"));
      } else {
        setServerError(t("auth.otpSendFailed"));
      }
    } finally {
      setCodeBusy(false);
    }
  };

  const confirm = async () => {
    if (!isValidOtp(otpCode)) {
      setOtpFieldError(t("auth.otpInvalid"));
      return;
    }
    setOtpFieldError(null);
    setBusy(true);
    setServerError(null);
    try {
      await deleteAccount(otpCode);
      await signOutAfterDeletion();
      // The group guard navigates to the welcome screen (goodbye state).
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setServerError(t("deleteAccount.otpRejected"));
      } else if (error instanceof ApiError && error.status === 409) {
        setServerError(t("deleteAccount.blocked"));
      } else {
        setServerError(t("common.networkError"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      keyboardShouldPersistTaps="handled"
      testID="delete-account-screen"
    >
      <Banner
        tone="warning"
        title={t("deleteAccount.consequencesTitle")}
        message={t("deleteAccount.consequences")}
        testID="delete-consequences"
      />

      {serverError ? (
        <Banner
          tone="danger"
          message={serverError}
          testID="delete-server-error"
        />
      ) : null}

      <SecondaryButton
        label={
          cooldown.active
            ? t("auth.otpResendIn", { seconds: cooldown.secondsLeft })
            : t("deleteAccount.sendCode")
        }
        onPress={() => void sendCode()}
        disabled={cooldown.active}
        loading={codeBusy}
        testID="delete-send-code"
      />

      {codeSent ? (
        <View style={styles.confirmBlock}>
          <TextField
            label={t("auth.otpLabel")}
            value={otpCode}
            onChangeText={setOtpCode}
            keyboardType="number-pad"
            maxLength={6}
            error={otpFieldError}
            testID="delete-otp"
          />
          <DestructiveTextButton
            label={t("deleteAccount.confirm")}
            onPress={confirm}
            loading={busy}
            testID="delete-confirm"
          />
        </View>
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  confirmBlock: {
    gap: spacing.lg,
  },
});
