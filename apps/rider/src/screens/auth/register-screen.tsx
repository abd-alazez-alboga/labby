import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  isValidPassword,
  isValidPhone,
  NAME_MAX_LENGTH,
  registerComplete,
  registerStart,
  registerVerify,
} from '../../api/auth';
import { ApiError } from '../../api/http-client';
import { useAuth } from '../../auth/auth-context';
import { Button, ErrorBanner, FormField } from '../../components/form';
import { OtpStep } from '../../components/otp-step';
import { useCooldown } from '../../hooks/use-cooldown';
import { useLocale } from '../../i18n/locale-context';
import { colors, fontSize, radius, spacing } from '../../theme/tokens';

type Step = 'phone' | 'otp' | 'details' | 'reactivated';

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
 */
export default function RegisterScreen() {
  const { t, isRTL } = useLocale();
  const { signIn } = useAuth();
  const router = useRouter();
  const cooldown = useCooldown();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  const trimmedPhone = phone.trim();

  const sendCode = async (resend: boolean) => {
    if (!resend) {
      setPhoneTaken(false);
      if (!isValidPhone(trimmedPhone)) {
        setPhoneError(t('auth.phoneInvalid'));
        return;
      }
      setPhoneError(null);
    }
    setBusy(true);
    setOtpError(null);
    try {
      await registerStart(trimmedPhone);
      cooldown.start();
      if (!resend) {
        setStep('otp');
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // UC-S-01 E5 — active/suspended account owns this phone.
        setPhoneTaken(true);
        setStep('phone');
      } else if (error instanceof ApiError && error.status === 429) {
        const message = t('auth.otpHourlyCap');
        if (resend) {
          setOtpError(message);
        } else {
          setPhoneError(message);
        }
      } else {
        // UC-S-01 E4 — SMS gateway unreachable / network failure.
        const message = t('auth.otpSendFailed');
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
      const result = await registerVerify(trimmedPhone, code);
      if (result.mode === 'reactivated') {
        // UC-S-08 — the deleted account is live again; user logs in.
        setStep('reactivated');
      } else {
        setRegistrationToken(result.registrationToken ?? null);
        setStep('details');
      }
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
    const nameOk = name.trim().length > 0 && name.trim().length <= NAME_MAX_LENGTH;
    const passwordOk = isValidPassword(password);
    setNameError(nameOk ? null : t('register.nameInvalid'));
    setPasswordError(passwordOk ? null : t('auth.passwordInvalid'));
    setTermsError(termsAccepted ? null : t('register.termsRequired'));
    if (!nameOk || !passwordOk || !termsAccepted || !registrationToken) {
      return;
    }
    setBusy(true);
    setCompleteError(null);
    try {
      const session = await registerComplete({
        registrationToken,
        password,
        name: name.trim(),
      });
      await signIn(session);
      // The (auth) group guard redirects into the app once signed in.
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setTokenExpired(true);
        setCompleteError(t('register.tokenExpired'));
      } else {
        setCompleteError(t('common.networkError'));
      }
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setStep('phone');
    setRegistrationToken(null);
    setTokenExpired(false);
    setCompleteError(null);
    setOtpError(null);
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      testID="register-screen"
    >
      {step === 'phone' ? (
        <View style={styles.step} testID="register-step-phone">
          <Text style={[styles.intro, isRTL && styles.textRtl]}>{t('register.phoneIntro')}</Text>
          {phoneTaken ? (
            <View style={styles.takenBox} testID="register-phone-taken">
              <ErrorBanner message={t('register.phoneTaken')} />
              <Button
                variant="link"
                label={t('register.phoneTakenAction')}
                onPress={() => router.replace('/login')}
                testID="register-go-login"
              />
            </View>
          ) : null}
          <FormField
            label={t('auth.phoneLabel')}
            placeholder={t('auth.phonePlaceholder')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            error={phoneError}
            testID="register-phone"
          />
          <Button
            label={t('register.sendCode')}
            onPress={() => sendCode(false)}
            loading={busy}
            testID="register-send-code"
          />
          <Button
            variant="link"
            label={t('register.haveAccount')}
            onPress={() => router.replace('/login')}
            testID="register-have-account"
          />
        </View>
      ) : null}

      {step === 'otp' ? (
        <View style={styles.step} testID="register-step-otp">
          <OtpStep
            hint={t('auth.otpHint', { phone: trimmedPhone })}
            error={otpError}
            busy={busy}
            onVerify={verifyCode}
            onResend={() => sendCode(true)}
            resendSecondsLeft={cooldown.secondsLeft}
            testIDPrefix="register-otp"
          />
        </View>
      ) : null}

      {step === 'details' ? (
        <View style={styles.step} testID="register-step-details">
          <Text style={[styles.title, isRTL && styles.textRtl]}>{t('register.detailsTitle')}</Text>
          <Text style={[styles.intro, isRTL && styles.textRtl]}>{t('register.detailsIntro')}</Text>
          {completeError ? (
            <ErrorBanner message={completeError} testID="register-complete-error" />
          ) : null}
          {tokenExpired ? (
            <Button
              variant="link"
              label={t('register.startOver')}
              onPress={startOver}
              testID="register-start-over"
            />
          ) : null}
          <FormField
            label={t('register.nameLabel')}
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX_LENGTH}
            error={nameError}
            testID="register-name"
          />
          <FormField
            label={t('auth.passwordLabel')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            error={passwordError}
            testID="register-password"
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: termsAccepted }}
            onPress={() => setTermsAccepted((v) => !v)}
            style={[styles.termsRow, isRTL && styles.rowRtl]}
            testID="register-terms"
          >
            <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
              {termsAccepted ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <Text style={[styles.termsLabel, isRTL && styles.textRtl]}>
              {t('register.termsLabel')}
            </Text>
          </Pressable>
          {termsError ? (
            <Text style={[styles.termsErrorText, isRTL && styles.textRtl]} testID="register-terms-error">
              {termsError}
            </Text>
          ) : null}
          <Button
            label={t('register.submit')}
            onPress={complete}
            loading={busy}
            testID="register-complete"
          />
        </View>
      ) : null}

      {step === 'reactivated' ? (
        <View style={styles.step} testID="register-step-reactivated">
          <Text style={[styles.title, isRTL && styles.textRtl]}>
            {t('register.reactivatedTitle')}
          </Text>
          <Text style={[styles.intro, isRTL && styles.textRtl]}>
            {t('register.reactivatedBody')}
          </Text>
          <Button
            label={t('register.reactivatedLogin')}
            onPress={() => router.replace('/login')}
            testID="register-reactivated-login"
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
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  takenBox: {
    gap: spacing.xs,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lavender200,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.purple700,
    borderColor: colors.purple700,
  },
  checkboxMark: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  termsLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    flexShrink: 1,
  },
  termsErrorText: {
    color: '#C0392B',
    fontSize: fontSize.sm,
  },
});
