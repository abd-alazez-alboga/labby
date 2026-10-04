import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { deleteMyAccount, requestTwoFactorCode } from '../../api/auth';
import {
  OTP_PATTERN,
  OTP_RESEND_COOLDOWN_SECONDS,
} from '../../api/auth-types';
import { clearSession } from '../../auth/session';
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

/**
 * UC-S-07 — soft delete with 2FA. The consequences copy states what the
 * SRS promises: access ends, data is retained, re-registering the phone
 * reactivates the account (USR-07). On 204 the server has revoked all
 * sessions, so we only clear the local one (no logout call).
 */
export function DeleteAccountScreen() {
  const { t } = useTranslation();

  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
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

  const confirmDelete = async () => {
    if (!OTP_PATTERN.test(code.trim())) {
      setFieldErrorKey('auth.validation.code');
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setBusy(true);
    try {
      await deleteMyAccount(code.trim());
      // Sessions are already revoked server-side; local sign-out routes
      // the user back to the welcome screen via the auth guards.
      await clearSession();
    } catch (error) {
      setErrorKey(
        errorKeyFor(error, {
          400: 'account.delete.wrongCode',
          409: 'account.delete.blocked',
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen testID="delete-account-screen">
      <ScreenTitle>{t('account.delete.title')}</ScreenTitle>
      <BodyText testID="delete-consequences">
        {t('account.delete.consequences')}
      </BodyText>

      {errorKey ? (
        <ErrorBanner testID="delete-error">{t(errorKey)}</ErrorBanner>
      ) : null}
      {codeSent ? (
        <InfoBanner testID="delete-code-sent">
          {t('account.password.codeSent')}
        </InfoBanner>
      ) : null}

      <TextButton
        title={
          cooldown.active
            ? t('auth.otp.resendIn', { seconds: cooldown.remaining })
            : t('account.delete.sendCode')
        }
        onPress={sendCode}
        disabled={cooldown.active || busy}
        testID="delete-send-code"
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
        testID="delete-code"
      />
      <PrimaryButton
        title={t('account.delete.confirm')}
        onPress={confirmDelete}
        busy={busy}
        danger
        testID="delete-confirm"
      />
    </FormScreen>
  );
}
