import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  isValidPassword,
  isValidPhone,
  passwordResetComplete,
  passwordResetStart,
  passwordResetVerify,
} from '../../api/auth';
import { ApiError } from '../../api/http-client';
import { Button, ErrorBanner, FormField, SuccessBanner } from '../../components/form';
import { OtpStep } from '../../components/otp-step';
import { useCooldown } from '../../hooks/use-cooldown';
import { useLocale } from '../../i18n/locale-context';
import { colors, fontSize, spacing } from '../../theme/tokens';

type Step = 'phone' | 'otp' | 'newPassword' | 'done';

/**
 * UC-S-04 — Reset forgotten password, three contract steps:
 * start (always 204, account-enumeration neutral) → verify (400/410) →
 * complete (400 invalid token/weak password; all sessions revoked).
 */
export default function ForgotPasswordScreen() {
  const { t, isRTL } = useLocale();
  const router = useRouter();
  const cooldown = useCooldown();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmedPhone = phone.trim();

  const sendCode = async (resend: boolean) => {
    if (!resend) {
      if (!isValidPhone(trimmedPhone)) {
        setPhoneError(t('auth.phoneInvalid'));
        return;
      }
      setPhoneError(null);
    }
    setBusy(true);
    setOtpError(null);
    try {
      await passwordResetStart(trimmedPhone);
      // Always 204 — neutral wording, no account enumeration (NFR-S3).
      cooldown.start();
      if (!resend) {
        setStep('otp');
      }
    } catch {
      const message = t('auth.otpSendFailed');
      if (resend) {
        setOtpError(message);
      } else {
        setPhoneError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (code: string) => {
    setBusy(true);
    setOtpError(null);
    try {
      const result = await passwordResetVerify(trimmedPhone, code);
      setResetToken(result.resetToken);
      setStep('newPassword');
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setOtpError(t('auth.otpWrong'));
      } else if (error instanceof ApiError && error.status === 410) {
        setOtpError(t('auth.otpExpired'));
      } else {
        setOtpError(t('common.networkError'));
      }
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    const passwordOk = isValidPassword(newPassword);
    const confirmOk = confirmPassword === newPassword;
    setPasswordError(passwordOk ? null : t('auth.passwordInvalid'));
    setConfirmError(confirmOk ? null : t('auth.passwordMismatch'));
    if (!passwordOk || !confirmOk || !resetToken) {
      return;
    }
    setBusy(true);
    setCompleteError(null);
    try {
      await passwordResetComplete(resetToken, newPassword);
      setStep('done');
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setCompleteError(t('forgot.resetTokenExpired'));
      } else {
        setCompleteError(t('common.networkError'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      testID="forgot-screen"
    >
      {step === 'phone' ? (
        <View style={styles.step} testID="forgot-step-phone">
          <Text style={[styles.intro, isRTL && styles.textRtl]}>{t('forgot.intro')}</Text>
          <FormField
            label={t('auth.phoneLabel')}
            placeholder={t('auth.phonePlaceholder')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            error={phoneError}
            testID="forgot-phone"
          />
          <Button
            label={t('forgot.sendCode')}
            onPress={() => sendCode(false)}
            loading={busy}
            testID="forgot-send-code"
          />
        </View>
      ) : null}

      {step === 'otp' ? (
        <View style={styles.step} testID="forgot-step-otp">
          <SuccessBanner message={t('forgot.codeSentNeutral')} testID="forgot-neutral-note" />
          <OtpStep
            hint={t('auth.otpHint', { phone: trimmedPhone })}
            error={otpError}
            busy={busy}
            onVerify={verifyCode}
            onResend={() => sendCode(true)}
            resendSecondsLeft={cooldown.secondsLeft}
            testIDPrefix="forgot-otp"
          />
        </View>
      ) : null}

      {step === 'newPassword' ? (
        <View style={styles.step} testID="forgot-step-password">
          <Text style={[styles.title, isRTL && styles.textRtl]}>
            {t('forgot.newPasswordTitle')}
          </Text>
          {completeError ? (
            <ErrorBanner message={completeError} testID="forgot-complete-error" />
          ) : null}
          <FormField
            label={t('forgot.newPasswordLabel')}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
            error={passwordError}
            testID="forgot-new-password"
          />
          <FormField
            label={t('auth.confirmPasswordLabel')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoCapitalize="none"
            error={confirmError}
            testID="forgot-confirm-password"
          />
          <Button
            label={t('forgot.submit')}
            onPress={complete}
            loading={busy}
            testID="forgot-complete"
          />
        </View>
      ) : null}

      {step === 'done' ? (
        <View style={styles.step} testID="forgot-step-done">
          <Text style={[styles.title, isRTL && styles.textRtl]}>{t('forgot.doneTitle')}</Text>
          <Text style={[styles.intro, isRTL && styles.textRtl]}>{t('forgot.doneBody')}</Text>
          <Button
            label={t('forgot.goToLogin')}
            onPress={() => router.replace('/login')}
            testID="forgot-go-login"
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bgLight,
  },
  container: {
    padding: spacing.lg,
  },
  step: {
    gap: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  intro: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
});
