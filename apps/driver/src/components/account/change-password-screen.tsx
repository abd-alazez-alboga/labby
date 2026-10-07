import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { changePassword, requestTwoFactorCode } from '../../api/auth';
import { registerThisDevice } from '../../notifications/push';
import {
  OTP_PATTERN,
  OTP_RESEND_COOLDOWN_SECONDS,
  PASSWORD_MIN_LENGTH,
} from '../../api/auth-types';
import { useAuth } from '../../auth/AuthProvider';
import {
  BodyText,
  ErrorBanner,
  Field,
  FormScreen,
  InfoBanner,
  PrimaryButton,
  ScreenTitle,
  TextButton,
  errorKeyFor,
} from '../auth/ui';
import { useCooldown } from '../auth/use-cooldown';

type Step = 'current' | 'code' | 'password' | 'done';

/**
 * UC-S-05 — change password with 2FA, staged like the reset flow: current
 * password (with an escape hatch to the reset flow) → OTP sent to the own
 * phone → new password + confirmation. The contract stays a single call, so
 * a wrong current password or stale OTP surfaces only at the final submit
 * (400) — handled with a start-over path. Other sessions are revoked
 * server-side (AUTH-05).
 */
export function ChangePasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuth();

  const [step, setStep] = useState<Step>('current');
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrorKey, setFieldErrorKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();

  const sendCode = async (isResend: boolean) => {
    if (!isResend && currentPassword.length === 0) {
      setFieldErrorKey('auth.validation.passwordRequired');
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setBusy(true);
    try {
      await requestTwoFactorCode();
      cooldown.start(OTP_RESEND_COOLDOWN_SECONDS);
      if (!isResend) {
        setCode('');
        setStep('code');
      }
    } catch (error) {
      setErrorKey(errorKeyFor(error, { 429: 'auth.otp.rateLimited' }));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = () => {
    if (!OTP_PATTERN.test(code.trim())) {
      setFieldErrorKey('auth.validation.code');
      return;
    }
    setFieldErrorKey(null);
    setStep('password');
  };

  const forgotPassword = async () => {
    await signOut();
    router.replace('/forgot-password');
  };

  const startOver = () => {
    setStep('current');
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
    setFieldErrorKey(null);
    setErrorKey(null);
  };

  const submit = async () => {
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setFieldErrorKey('auth.validation.password');
      return;
    }
    if (confirmPassword !== newPassword) {
      setFieldErrorKey('auth.validation.confirm');
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setBusy(true);
    try {
      await changePassword({
        currentPassword,
        otpCode: code.trim(),
        newPassword,
      });
      // The server drops every push token of the account on a password change (sessions are
      // revoked); this device stays signed in, so it registers its token again — never prompting.
      void registerThisDevice({ prompt: false }).catch(() => {});
      setStep('done');
    } catch (error) {
      setErrorKey(errorKeyFor(error, { 400: 'account.password.invalid' }));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <FormScreen testID="change-password-done">
        <InfoBanner testID="change-password-info">
          {t('account.password.done')}
        </InfoBanner>
      </FormScreen>
    );
  }

  return (
    <FormScreen testID="change-password-screen">
      {errorKey ? (
        <ErrorBanner testID="change-password-error">{t(errorKey)}</ErrorBanner>
      ) : null}

      {step === 'current' ? (
        <>
          <BodyText>{t('account.password.codeHint')}</BodyText>
          <Field
            label={t('auth.fields.currentPassword')}
            secureTextEntry
            autoCapitalize="none"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            error={
              fieldErrorKey === 'auth.validation.passwordRequired'
                ? t(fieldErrorKey)
                : null
            }
            testID="change-password-current"
          />
          <PrimaryButton
            title={t('account.password.continue')}
            onPress={() => void sendCode(false)}
            busy={busy}
            testID="change-password-continue"
          />
          <TextButton
            title={t('account.password.forgotLink')}
            onPress={() => void forgotPassword()}
            testID="change-password-forgot"
          />
        </>
      ) : null}

      {step === 'code' ? (
        <>
          <InfoBanner testID="change-password-code-sent">
            {t('account.password.codeSent')}
          </InfoBanner>
          <Field
            label={t('auth.fields.code')}
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
            error={
              fieldErrorKey === 'auth.validation.code' ? t(fieldErrorKey) : null
            }
            testID="change-password-code"
          />
          <PrimaryButton
            title={t('auth.reset.verifyCta')}
            onPress={verifyCode}
            busy={busy}
            testID="change-password-verify"
          />
          <TextButton
            title={
              cooldown.active
                ? t('auth.otp.resendIn', { seconds: cooldown.remaining })
                : t('auth.otp.resend')
            }
            onPress={() => void sendCode(true)}
            disabled={cooldown.active || busy}
            testID="change-password-resend"
          />
        </>
      ) : null}

      {step === 'password' ? (
        <>
          <ScreenTitle>{t('account.password.newTitle')}</ScreenTitle>
          {errorKey ? (
            <TextButton
              title={t('account.password.startOver')}
              onPress={startOver}
              testID="change-password-start-over"
            />
          ) : null}
          <Field
            label={t('auth.fields.newPassword')}
            secureTextEntry
            autoCapitalize="none"
            value={newPassword}
            onChangeText={setNewPassword}
            error={
              fieldErrorKey === 'auth.validation.password'
                ? t(fieldErrorKey)
                : null
            }
            testID="change-password-new"
          />
          <Field
            label={t('auth.fields.confirmPassword')}
            secureTextEntry
            autoCapitalize="none"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={
              fieldErrorKey === 'auth.validation.confirm'
                ? t(fieldErrorKey)
                : null
            }
            testID="change-password-confirm"
          />
          <PrimaryButton
            title={t('account.password.submit')}
            onPress={submit}
            busy={busy}
            testID="change-password-submit"
          />
        </>
      ) : null}
    </FormScreen>
  );
}
