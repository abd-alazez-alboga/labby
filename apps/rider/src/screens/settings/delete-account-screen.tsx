import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { deleteAccount, isValidOtp, request2faCode } from '../../api/auth';
import { ApiError } from '../../api/http-client';
import { useAuth } from '../../auth/auth-context';
import { Button, ErrorBanner, FormField } from '../../components/form';
import { useCooldown } from '../../hooks/use-cooldown';
import { useLocale } from '../../i18n/locale-context';
import { ScreenScrollView } from '../../components/screen';
import { colors, fontSize, radius, spacing } from '../../theme/tokens';

/**
 * UC-S-07 — Delete account (2FA, soft). Shows the consequences first
 * (access ends, data retained, re-registration reactivates), verifies a
 * 2FA OTP, then soft-deletes. On 204 the user is signed out locally with
 * reason `deleted`, which drives the goodbye state on the welcome screen.
 * 409 — blocked by a precondition (active ride, unsettled balance).
 */
export default function DeleteAccountScreen() {
  const { t, isRTL } = useLocale();
  const { signOutAfterDeletion } = useAuth();
  const cooldown = useCooldown();

  const [otpCode, setOtpCode] = useState('');
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
        setServerError(t('auth.otpHourlyCap'));
      } else {
        setServerError(t('auth.otpSendFailed'));
      }
    } finally {
      setCodeBusy(false);
    }
  };

  const confirm = async () => {
    if (!isValidOtp(otpCode)) {
      setOtpFieldError(t('auth.otpInvalid'));
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
        setServerError(t('deleteAccount.otpRejected'));
      } else if (error instanceof ApiError && error.status === 409) {
        setServerError(t('deleteAccount.blocked'));
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
      testID="delete-account-screen"
    >
      <View style={styles.consequences} testID="delete-consequences">
        <Text style={[styles.consequencesTitle, isRTL && styles.textRtl]}>
          {t('deleteAccount.consequencesTitle')}
        </Text>
        <Text style={[styles.consequencesBody, isRTL && styles.textRtl]}>
          {t('deleteAccount.consequences')}
        </Text>
      </View>

      {serverError ? <ErrorBanner message={serverError} testID="delete-server-error" /> : null}

      <Button
        variant="secondary"
        label={
          cooldown.active
            ? t('auth.otpResendIn', { seconds: cooldown.secondsLeft })
            : t('deleteAccount.sendCode')
        }
        onPress={() => void sendCode()}
        disabled={cooldown.active}
        loading={codeBusy}
        testID="delete-send-code"
      />

      {codeSent ? (
        <View style={styles.confirmBlock}>
          <FormField
            label={t('auth.otpLabel')}
            value={otpCode}
            onChangeText={setOtpCode}
            keyboardType="number-pad"
            maxLength={6}
            error={otpFieldError}
            testID="delete-otp"
          />
          <Button
            variant="danger"
            label={t('deleteAccount.confirm')}
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
  scroll: {
    flex: 1,
    backgroundColor: colors.bgLight,
  },
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  consequences: {
    backgroundColor: colors.lilac100,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  consequencesTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  consequencesBody: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  confirmBlock: {
    gap: spacing.md,
  },
});
