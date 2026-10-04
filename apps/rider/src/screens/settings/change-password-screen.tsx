import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { changePassword, isValidOtp, isValidPassword, request2faCode } from '../../api/auth';
import { ApiError } from '../../api/http-client';
import { Button, ErrorBanner, FormField, SuccessBanner } from '../../components/form';
import { useCooldown } from '../../hooks/use-cooldown';
import { useLocale } from '../../i18n/locale-context';
import { colors, fontSize, spacing } from '../../theme/tokens';

/**
 * UC-S-05 — Change password (2FA): current password + OTP (purpose `2fa`,
 * requested via /users/me/2fa/request) + new password in one contract call.
 * 400 → wrong current password or OTP; other sessions revoked on success.
 */
export default function ChangePasswordScreen() {
  const { t, isRTL } = useLocale();
  const cooldown = useCooldown();

  const [currentPassword, setCurrentPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const sendCode = async () => {
    setServerError(null);
    setCodeBusy(true);
    try {
      await request2faCode();
      cooldown.start();
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setServerError(t('auth.otpHourlyCap'));
      } else {
        setServerError(t('auth.otpSendFailed'));
      }
    } finally {
      setCodeBusy(false);
    }
  };

  const submit = async () => {
    const currentOk = currentPassword.length > 0;
    const otpOk = isValidOtp(otpCode);
    const newOk = isValidPassword(newPassword);
    setCurrentError(currentOk ? null : t('changePassword.currentRequired'));
    setOtpError(otpOk ? null : t('auth.otpInvalid'));
    setNewError(newOk ? null : t('auth.passwordInvalid'));
    if (!currentOk || !otpOk || !newOk) {
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      await changePassword({ currentPassword, otpCode, newPassword });
      setDone(true);
      setCurrentPassword('');
      setOtpCode('');
      setNewPassword('');
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
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      testID="change-password-screen"
    >
      <Text style={[styles.intro, isRTL && styles.textRtl]}>{t('changePassword.intro')}</Text>
      {serverError ? <ErrorBanner message={serverError} testID="change-password-error" /> : null}
      {done ? <SuccessBanner message={t('changePassword.done')} testID="change-password-done" /> : null}

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
        variant="secondary"
        label={
          cooldown.active
            ? t('auth.otpResendIn', { seconds: cooldown.secondsLeft })
            : t('changePassword.sendCode')
        }
        onPress={() => void sendCode()}
        disabled={cooldown.active}
        loading={codeBusy}
        testID="change-password-send-code"
      />
      <FormField
        label={t('auth.otpLabel')}
        value={otpCode}
        onChangeText={setOtpCode}
        keyboardType="number-pad"
        maxLength={6}
        error={otpError}
        testID="change-password-otp"
      />
      <FormField
        label={t('changePassword.newLabel')}
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        autoCapitalize="none"
        error={newError}
        testID="change-password-new"
      />
      <Button
        label={t('changePassword.title')}
        onPress={submit}
        loading={busy}
        testID="change-password-submit"
      />
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
    gap: spacing.md,
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
