import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { changePassword, requestTwoFactorCode } from '../../api/auth';
import {
  OTP_PATTERN,
  OTP_RESEND_COOLDOWN_SECONDS,
  PASSWORD_MIN_LENGTH,
} from '../../api/auth-types';
import {
  BodyText,
  ErrorBanner,
  Field,
  FormScreen,
  InfoBanner,
  PrimaryButton,
  TextButton,
  errorKeyFor,
} from '../auth/ui';
import { useCooldown } from '../auth/use-cooldown';

/**
 * UC-S-05 — change password with 2FA: current password + OTP sent to the
 * own phone + new password in one contract call. Other sessions are
 * revoked server-side (AUTH-05).
 */
export function ChangePasswordScreen() {
  const { t } = useTranslation();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [done, setDone] = useState(false);
  const [fieldErrorKey, setFieldErrorKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();

  const sendCode = async () => {
    setErrorKey(null);
    setBusy(true);
    try {
      await requestTwoFactorCode();
      setCodeSent(true);
      cooldown.start(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      setErrorKey(errorKeyFor(error, { 429: 'auth.otp.rateLimited' }));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (currentPassword.length === 0) {
      setFieldErrorKey('auth.validation.passwordRequired');
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setFieldErrorKey('auth.validation.password');
      return;
    }
    if (!OTP_PATTERN.test(code.trim())) {
      setFieldErrorKey('auth.validation.code');
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
      setDone(true);
    } catch (error) {
      setErrorKey(errorKeyFor(error, { 400: 'account.password.invalid' }));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
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
      {codeSent ? (
        <InfoBanner testID="change-password-code-sent">
          {t('account.password.codeSent')}
        </InfoBanner>
      ) : null}

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
      <Field
        label={t('auth.fields.newPassword')}
        secureTextEntry
        autoCapitalize="none"
        value={newPassword}
        onChangeText={setNewPassword}
        error={
          fieldErrorKey === 'auth.validation.password' ? t(fieldErrorKey) : null
        }
        testID="change-password-new"
      />

      <BodyText>{t('account.password.codeHint')}</BodyText>
      <TextButton
        title={
          cooldown.active
            ? t('auth.otp.resendIn', { seconds: cooldown.remaining })
            : t('account.password.sendCode')
        }
        onPress={sendCode}
        disabled={cooldown.active || busy}
        testID="change-password-send-code"
      />
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
        title={t('account.password.submit')}
        onPress={submit}
        busy={busy}
        testID="change-password-submit"
      />
    </FormScreen>
  );
}
