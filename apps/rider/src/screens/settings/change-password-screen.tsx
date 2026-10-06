import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { changePassword, isValidPassword, request2faCode } from '../../api/auth';
import { ApiError } from '../../api/http-client';
import { useAuth } from '../../auth/auth-context';
import { Button, ErrorBanner, FormField, SuccessBanner } from '../../components/form';
import { OtpStep } from '../../components/otp-step';
import { useCooldown } from '../../hooks/use-cooldown';
import { useLocale } from '../../i18n/locale-context';
import { ScreenScrollView } from '../../components/screen';
import { colors, fontSize, spacing } from '../../theme/tokens';

type Step = 'current' | 'otp' | 'newPassword' | 'done';

/**
 * UC-S-05 — Change password (2FA), staged like the reset flow: current
 * password (with an escape hatch to the reset flow for users who forgot it)
 * → request OTP (purpose `2fa`) → OTP entry → new password + confirmation.
 * The contract stays a single call, so a wrong current password or stale OTP
 * surfaces only at the final submit (400) — handled with a start-over path.
 */
export default function ChangePasswordScreen() {
  const { t, isRTL } = useLocale();
  const router = useRouter();
  const { signOut } = useAuth();
  const cooldown = useCooldown();

  const [step, setStep] = useState<Step>('current');
  const [currentPassword, setCurrentPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async (resend: boolean) => {
    if (!resend) {
      const currentOk = currentPassword.length > 0;
      setCurrentError(currentOk ? null : t('changePassword.currentRequired'));
      if (!currentOk) {
        return;
      }
    }
    setServerError(null);
    setOtpError(null);
    setBusy(true);
    try {
      await request2faCode();
      cooldown.start();
      if (!resend) {
        setStep('otp');
      }
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? t('auth.otpHourlyCap')
          : t('auth.otpSendFailed');
      if (resend) {
        setOtpError(message);
      } else {
        setServerError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    await signOut();
    router.replace('/forgot-password');
  };

  const startOver = () => {
    setStep('current');
    setOtpCode('');
    setNewPassword('');
    setConfirmPassword('');
    setServerError(null);
    setNewError(null);
    setConfirmError(null);
  };

  const submit = async () => {
    const newOk = isValidPassword(newPassword);
    const confirmOk = confirmPassword === newPassword;
    setNewError(newOk ? null : t('auth.passwordInvalid'));
    setConfirmError(confirmOk ? null : t('auth.passwordMismatch'));
    if (!newOk || !confirmOk) {
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      await changePassword({ currentPassword, otpCode, newPassword });
      setStep('done');
      setCurrentPassword('');
      setOtpCode('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setServerError(t('changePassword.rejected'));
      } else {
        setServerError(t('common.networkError'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      testID="change-password-screen"
    >
      {step === 'current' ? (
        <>
          <Text style={[styles.intro, isRTL && styles.textRtl]}>{t('changePassword.intro')}</Text>
          {serverError ? (
            <ErrorBanner message={serverError} testID="change-password-error" />
          ) : null}
          <FormField
            label={t('changePassword.currentLabel')}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            autoCapitalize="none"
            error={currentError}
            testID="change-password-current"
          />
          <Button
            label={t('common.continue')}
            onPress={() => void sendCode(false)}
            loading={busy}
            testID="change-password-continue"
          />
          <Button
            variant="link"
            label={t('changePassword.forgotLink')}
            onPress={() => void forgotPassword()}
            testID="change-password-forgot"
          />
        </>
      ) : null}

      {step === 'otp' ? (
        <OtpStep
          hint={t('changePassword.otpHint')}
          error={otpError}
          busy={busy}
          onVerify={(code) => {
            setOtpCode(code);
            setStep('newPassword');
          }}
          onResend={() => void sendCode(true)}
          resendSecondsLeft={cooldown.secondsLeft}
          testIDPrefix="change-password-otp"
        />
      ) : null}

      {step === 'newPassword' ? (
        <>
          <Text style={[styles.title, isRTL && styles.textRtl]}>
            {t('changePassword.newTitle')}
          </Text>
          {serverError ? (
            <>
              <ErrorBanner message={serverError} testID="change-password-error" />
              <Button
                variant="link"
                label={t('changePassword.startOver')}
                onPress={startOver}
                testID="change-password-start-over"
              />
            </>
          ) : null}
          <FormField
            label={t('changePassword.newLabel')}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
            error={newError}
            testID="change-password-new"
          />
          <FormField
            label={t('auth.confirmPasswordLabel')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoCapitalize="none"
            error={confirmError}
            testID="change-password-confirm"
          />
          <Button
            label={t('changePassword.title')}
            onPress={submit}
            loading={busy}
            testID="change-password-submit"
          />
        </>
      ) : null}

      {step === 'done' ? (
        <SuccessBanner message={t('changePassword.done')} testID="change-password-done" />
      ) : null}
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
  intro: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
});
