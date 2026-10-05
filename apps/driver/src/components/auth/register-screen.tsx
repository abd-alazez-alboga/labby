import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  BodyText,
  CheckboxRow,
  ErrorBanner,
  Field,
  FormScreen,
  InfoBanner,
  PrimaryButton,
  ScreenTitle,
  TextButton,
  errorKeyFor,
} from './ui';
import { useCooldown } from './use-cooldown';
import { registerComplete, registerStart, registerVerify } from '../../api/auth';
import {
  OTP_PATTERN,
  OTP_RESEND_COOLDOWN_SECONDS,
  PASSWORD_MIN_LENGTH,
  PHONE_PATTERN,
} from '../../api/auth-types';
import { useAuth } from '../../auth/AuthProvider';

type Step = 'phone' | 'code' | 'details' | 'reactivated';

/**
 * UC-S-01 — register: phone -> OTP (resend after 60s, max 5/hour) ->
 * password + name. A deleted account's phone takes the UC-S-08
 * reactivation branch at the verify step instead.
 */
export function RegisterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { applySession } = useAuth();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registrationToken, setRegistrationToken] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [fieldErrorKey, setFieldErrorKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();

  const sendCode = async (isResend: boolean) => {
    const trimmed = phone.trim();
    if (!PHONE_PATTERN.test(trimmed)) {
      setFieldErrorKey('auth.validation.phone');
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setBusy(true);
    try {
      await registerStart(trimmed);
      cooldown.start(OTP_RESEND_COOLDOWN_SECONDS);
      setCode('');
      if (!isResend) setStep('code');
    } catch (error) {
      setErrorKey(
        errorKeyFor(error, {
          409: 'auth.register.phoneTaken',
          429: 'auth.otp.rateLimited',
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!OTP_PATTERN.test(code.trim())) {
      setFieldErrorKey('auth.validation.code');
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setBusy(true);
    try {
      const result = await registerVerify(phone.trim(), code.trim());
      if (result.mode === 'reactivated') {
        // UC-S-08: the deleted account is live again — no new account.
        setStep('reactivated');
      } else {
        setRegistrationToken(result.registrationToken ?? '');
        setStep('details');
      }
    } catch (error) {
      setErrorKey(
        errorKeyFor(error, {
          400: 'auth.otp.wrongCode',
          410: 'auth.otp.expired',
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (name.trim().length === 0) {
      setFieldErrorKey('auth.validation.name');
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setFieldErrorKey('auth.validation.password');
      return;
    }
    if (confirmPassword !== password) {
      setFieldErrorKey('auth.validation.confirm');
      return;
    }
    if (!termsAccepted) {
      setFieldErrorKey('auth.validation.terms');
      return;
    }
    setFieldErrorKey(null);
    setErrorKey(null);
    setBusy(true);
    try {
      const tokens = await registerComplete({
        registrationToken,
        password,
        name: name.trim(),
        termsAccepted,
      });
      await applySession(tokens);
      // Navigation happens via the auth guards in the root layout.
    } catch (error) {
      setErrorKey(errorKeyFor(error, { 400: 'auth.register.invalidToken' }));
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setStep('phone');
    setCode('');
    setRegistrationToken('');
    setErrorKey(null);
    setFieldErrorKey(null);
  };

  return (
    <FormScreen testID={`register-step-${step}`}>
      <ScreenTitle>{t('auth.register.title')}</ScreenTitle>
      {errorKey ? (
        <ErrorBanner testID="register-error">{t(errorKey)}</ErrorBanner>
      ) : null}

      {step === 'phone' ? (
        <>
          <Field
            label={t('auth.fields.phone')}
            placeholder={t('auth.fields.phonePlaceholder')}
            keyboardType="phone-pad"
            autoCapitalize="none"
            value={phone}
            onChangeText={setPhone}
            error={
              fieldErrorKey === 'auth.validation.phone' ? t(fieldErrorKey) : null
            }
            testID="register-phone"
          />
          <PrimaryButton
            title={t('auth.register.phoneCta')}
            onPress={() => sendCode(false)}
            busy={busy}
            testID="register-send-code"
          />
          {errorKey === 'auth.register.phoneTaken' ? (
            <TextButton
              title={t('auth.register.goToLogin')}
              onPress={() => router.replace('/login')}
              testID="register-go-login"
            />
          ) : null}
        </>
      ) : null}

      {step === 'code' ? (
        <>
          <BodyText testID="register-otp-hint">
            {t('auth.otp.sentTo', { phone: phone.trim() })}
          </BodyText>
          <Field
            label={t('auth.fields.code')}
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
            error={
              fieldErrorKey === 'auth.validation.code' ? t(fieldErrorKey) : null
            }
            testID="register-code"
          />
          <PrimaryButton
            title={t('auth.register.verifyCta')}
            onPress={verifyCode}
            busy={busy}
            testID="register-verify"
          />
          <TextButton
            title={
              cooldown.active
                ? t('auth.otp.resendIn', { seconds: cooldown.remaining })
                : t('auth.otp.resend')
            }
            onPress={() => sendCode(true)}
            disabled={cooldown.active || busy}
            testID="register-resend"
          />
        </>
      ) : null}

      {step === 'details' ? (
        <>
          <BodyText>{t('auth.register.detailsHint')}</BodyText>
          <Field
            label={t('auth.fields.name')}
            value={name}
            onChangeText={setName}
            maxLength={100}
            error={
              fieldErrorKey === 'auth.validation.name' ? t(fieldErrorKey) : null
            }
            testID="register-name"
          />
          <Field
            label={t('auth.fields.password')}
            secureTextEntry
            autoCapitalize="none"
            value={password}
            onChangeText={setPassword}
            error={
              fieldErrorKey === 'auth.validation.password'
                ? t(fieldErrorKey)
                : null
            }
            testID="register-password"
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
            testID="register-confirm-password"
          />
          <CheckboxRow
            label={t('auth.register.termsLabel')}
            checked={termsAccepted}
            onToggle={() => setTermsAccepted((value) => !value)}
            error={
              fieldErrorKey === 'auth.validation.terms' ? t(fieldErrorKey) : null
            }
            testID="register-terms"
          />
          <PrimaryButton
            title={t('auth.register.completeCta')}
            onPress={complete}
            busy={busy}
            testID="register-complete"
          />
          {errorKey === 'auth.register.invalidToken' ? (
            <TextButton
              title={t('auth.register.startOver')}
              onPress={startOver}
              testID="register-start-over"
            />
          ) : null}
        </>
      ) : null}

      {step === 'reactivated' ? (
        <>
          <InfoBanner testID="register-reactivated">
            {t('auth.register.reactivatedTitle')}
          </InfoBanner>
          <BodyText>{t('auth.register.reactivatedBody')}</BodyText>
          <PrimaryButton
            title={t('auth.register.goToLogin')}
            onPress={() => router.replace('/login')}
            testID="register-reactivated-login"
          />
          <TextButton
            title={t('auth.login.forgot')}
            onPress={() => router.replace('/forgot-password')}
            testID="register-reactivated-reset"
          />
        </>
      ) : null}
    </FormScreen>
  );
}
