/**
 * Shared OTP entry step: 6-digit code input, verify button, and a resend
 * button with the AUTH-04 60-second cooldown countdown. The parent owns the
 * API calls and the cooldown clock (so it can arm it whenever a code is
 * actually sent) — this component is pure presentation + local code state.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { isValidOtp } from '../api/auth';
import { useLocale } from '../i18n/locale-context';
import { colors, fontSize, spacing } from '../theme/tokens';
import { Button, ErrorBanner, FormField } from './form';

export interface OtpStepProps {
  /** Localized hint line, e.g. "Enter the 6-digit code we sent to …". */
  hint: string;
  /** Server/flow error message to show, if any. */
  error?: string | null;
  busy?: boolean;
  onVerify: (code: string) => void;
  /** Omit to hide the resend affordance (e.g. phone-change step 3 restart). */
  onResend?: () => void;
  /** Seconds left on the resend cooldown; resend is disabled while > 0. */
  resendSecondsLeft?: number;
  testIDPrefix?: string;
}

export function OtpStep({
  hint,
  error,
  busy,
  onVerify,
  onResend,
  resendSecondsLeft = 0,
  testIDPrefix = 'otp',
}: OtpStepProps) {
  const { t, isRTL } = useLocale();
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    if (!isValidOtp(code)) {
      setLocalError(t('auth.otpInvalid'));
      return;
    }
    setLocalError(null);
    onVerify(code);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.hint, isRTL && styles.textRtl]}>{hint}</Text>
      {error ? <ErrorBanner message={error} testID={`${testIDPrefix}-server-error`} /> : null}
      <FormField
        label={t('auth.otpLabel')}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
        error={localError}
        testID={`${testIDPrefix}-code-input`}
      />
      <Button
        label={t('auth.verify')}
        onPress={submit}
        loading={busy}
        testID={`${testIDPrefix}-verify`}
      />
      {onResend ? (
        <Button
          variant="link"
          label={
            resendSecondsLeft > 0
              ? t('auth.otpResendIn', { seconds: resendSecondsLeft })
              : t('auth.otpResend')
          }
          onPress={onResend}
          disabled={resendSecondsLeft > 0 || busy}
          testID={`${testIDPrefix}-resend`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  hint: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
});
