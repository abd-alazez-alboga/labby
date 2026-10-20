import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  isValidPassword,
  isValidPhone,
  normalizePhone,
  NAME_MAX_LENGTH,
  registerComplete,
  registerStart,
  registerVerify,
} from "../../api/auth";
import { ApiError } from "../../api/http-client";
import { useAuth } from "../../auth/auth-context";
import { OtpStep } from "../../components/otp-step";
import {
  AppText,
  Banner,
  PrimaryButton,
  ScreenScrollView,
  screenStyles,
  TextButton,
  TextField,
  useDirection,
} from "../../components/ui";
import { useCooldown } from "../../hooks/use-cooldown";
import { useLocale } from "../../i18n/locale-context";
import { colors, spacing } from "../../theme/tokens";

type Step = "phone" | "otp" | "details" | "reactivated";

/**
 * UC-S-01 — Register (phone → OTP → password+name) and
 * UC-S-08 — reactivation branch when the phone belongs to a deleted account.
 *
 * Exception paths rendered:
 * - E1/E2 wrong code (400) and expired/attempts-exhausted (410) on verify
 * - A2/E3 resend with 60 s cooldown; hourly cap (429)
 * - E4 SMS send failure (network / 5xx)
 * - E5 phone already registered (409) → redirect to login
 * - expired registrationToken on complete (400) → start over
 * - M13 (GRW-03 / UC-R-18): an optional referral code on the details step,
 *   refused codes (404 / 409 `referral_phone_used`) shown under the field
 */
export default function RegisterScreen() {
  const { t } = useLocale();
  const { row } = useDirection();
  const { signIn } = useAuth();
  const router = useRouter();
  const cooldown = useCooldown();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [registrationToken, setRegistrationToken] = useState<string | null>(
    null,
  );
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [referralCode, setReferralCode] = useState("");
  const [referralError, setReferralError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  const canonicalPhone = normalizePhone(phone);

  const sendCode = async (resend: boolean) => {
    if (!resend) {
      setPhoneTaken(false);
      if (!isValidPhone(canonicalPhone)) {
        setPhoneError(t("auth.phoneInvalid"));
        return;
      }
      setPhoneError(null);
    }
    setBusy(true);
    setOtpError(null);
    try {
      await registerStart(canonicalPhone);
      cooldown.start();
      if (!resend) {
        setStep("otp");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // UC-S-01 E5 — active/suspended account owns this phone.
        setPhoneTaken(true);
        setStep("phone");
      } else if (error instanceof ApiError && error.status === 429) {
        const message = t("auth.otpHourlyCap");
        if (resend) {
          setOtpError(message);
        } else {
          setPhoneError(message);
        }
      } else {
        // UC-S-01 E4 — SMS gateway unreachable / network failure.
        const message = t("auth.otpSendFailed");
        if (resend) {
          setOtpError(message);
        } else {
          setPhoneError(message);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (code: string) => {
    setBusy(true);
    setOtpError(null);
    try {
      const result = await registerVerify(canonicalPhone, code);
      if (result.mode === "reactivated") {
        // UC-S-08 — the deleted account is live again; user logs in.
        setStep("reactivated");
      } else {
        setRegistrationToken(result.registrationToken ?? null);
        setStep("details");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setOtpError(t("auth.otpWrong"));
      } else if (error instanceof ApiError && error.status === 410) {
        setOtpError(t("auth.otpExpired"));
      } else {
        setOtpError(t("common.networkError"));
      }
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    const nameOk =
      name.trim().length > 0 && name.trim().length <= NAME_MAX_LENGTH;
    const passwordOk = isValidPassword(password);
    const confirmOk = confirmPassword === password;
    setNameError(nameOk ? null : t("register.nameInvalid"));
    setPasswordError(passwordOk ? null : t("auth.passwordInvalid"));
    setConfirmError(confirmOk ? null : t("auth.passwordMismatch"));
    setTermsError(termsAccepted ? null : t("register.termsRequired"));
    if (
      !nameOk ||
      !passwordOk ||
      !confirmOk ||
      !termsAccepted ||
      !registrationToken
    ) {
      return;
    }
    setBusy(true);
    setCompleteError(null);
    setReferralError(null);
    const trimmedCode = referralCode.trim();
    try {
      const session = await registerComplete({
        registrationToken,
        password,
        name: name.trim(),
        termsAccepted,
        ...(trimmedCode ? { referralCode: trimmedCode } : {}),
      });
      await signIn(session);
      // The (auth) group guard redirects into the app once signed in.
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setTokenExpired(true);
        setCompleteError(t("register.tokenExpired"));
      } else if (
        error instanceof ApiError &&
        error.status === 404 &&
        error.body?.code === "referral_code_not_found"
      ) {
        // GRW-03: the code is checked with the account; nothing was created.
        setReferralError(t("register.referralUnknown"));
      } else if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.body?.code === "referral_phone_used"
      ) {
        setReferralError(t("register.referralPhoneUsed"));
      } else if (error instanceof ApiError && error.status === 409) {
        // Concurrent registration won the race — the phone is now taken.
        setPhoneTaken(true);
        setStep("phone");
      } else {
        setCompleteError(t("common.networkError"));
      }
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setStep("phone");
    setRegistrationToken(null);
    setTokenExpired(false);
    setCompleteError(null);
    setOtpError(null);
  };

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      keyboardShouldPersistTaps="handled"
      testID="register-screen"
    >
      {step === "phone" ? (
        <View style={styles.step} testID="register-step-phone">
          <AppText variant="body" tone="secondary">
            {t("register.phoneIntro")}
          </AppText>
          {phoneTaken ? (
            <View style={styles.takenBox} testID="register-phone-taken">
              <Banner
                tone="danger"
                message={t("register.phoneTaken")}
                testID="error-banner"
              />
              <TextButton
                label={t("register.phoneTakenAction")}
                onPress={() => router.replace("/login")}
                testID="register-go-login"
              />
            </View>
          ) : null}
          <TextField
            label={t("auth.phoneLabel")}
            placeholder={t("auth.phonePlaceholder")}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            error={phoneError}
            testID="register-phone"
          />
          <PrimaryButton
            label={t("register.sendCode")}
            onPress={() => sendCode(false)}
            loading={busy}
            testID="register-send-code"
          />
          <TextButton
            label={t("register.haveAccount")}
            onPress={() => router.replace("/login")}
            testID="register-have-account"
          />
        </View>
      ) : null}

      {step === "otp" ? (
        <View style={styles.step} testID="register-step-otp">
          <OtpStep
            hint={t("auth.otpHint", { phone: canonicalPhone })}
            error={otpError}
            busy={busy}
            onVerify={verifyCode}
            onResend={() => sendCode(true)}
            resendSecondsLeft={cooldown.secondsLeft}
            testIDPrefix="register-otp"
          />
        </View>
      ) : null}

      {step === "details" ? (
        <View style={styles.step} testID="register-step-details">
          <AppText variant="heading">{t("register.detailsTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {t("register.detailsIntro")}
          </AppText>
          {completeError ? (
            <Banner
              tone="danger"
              message={completeError}
              testID="register-complete-error"
            />
          ) : null}
          {tokenExpired ? (
            <TextButton
              label={t("register.startOver")}
              onPress={startOver}
              testID="register-start-over"
            />
          ) : null}
          <TextField
            label={t("register.nameLabel")}
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX_LENGTH}
            error={nameError}
            testID="register-name"
          />
          <TextField
            label={t("auth.passwordLabel")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            error={passwordError}
            testID="register-password"
          />
          <TextField
            label={t("auth.confirmPasswordLabel")}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoCapitalize="none"
            error={confirmError}
            testID="register-confirm-password"
          />
          <TextField
            label={t("register.referralLabel")}
            value={referralCode}
            onChangeText={(value) => {
              setReferralCode(value);
              setReferralError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={32}
            error={referralError}
            testID="register-referral-code"
          />
          <AppText
            variant="secondary"
            tone="secondary"
            testID="register-referral-hint"
          >
            {t("register.referralHint")}
          </AppText>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: termsAccepted }}
            onPress={() => setTermsAccepted((v) => !v)}
            style={[styles.termsRow, { flexDirection: row }]}
            testID="register-terms"
          >
            <View
              style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}
            >
              {termsAccepted ? (
                <Ionicons name="checkmark" size={18} color={colors.onAccent} />
              ) : null}
            </View>
            <AppText variant="body" tone="secondary" style={styles.termsLabel}>
              {t("register.termsLabel")}
            </AppText>
          </Pressable>
          {termsError ? (
            <AppText
              variant="secondary"
              tone="danger"
              testID="register-terms-error"
            >
              {termsError}
            </AppText>
          ) : null}
          <PrimaryButton
            label={t("register.submit")}
            onPress={complete}
            loading={busy}
            testID="register-complete"
          />
        </View>
      ) : null}

      {step === "reactivated" ? (
        <View style={styles.step} testID="register-step-reactivated">
          <AppText variant="heading">{t("register.reactivatedTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {t("register.reactivatedBody")}
          </AppText>
          <PrimaryButton
            label={t("register.reactivatedLogin")}
            onPress={() => router.replace("/login")}
            testID="register-reactivated-login"
          />
        </View>
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: spacing.lg,
  },
  takenBox: {
    gap: spacing.xs,
  },
  termsRow: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  termsLabel: {
    flexShrink: 1,
  },
});
