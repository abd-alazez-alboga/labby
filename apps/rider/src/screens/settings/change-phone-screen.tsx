import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  isValidPhone,
  phoneChangeComplete,
  phoneChangeStart,
  phoneChangeVerifyCurrent,
} from '../../api/auth';
import { ApiError } from '../../api/http-client';
import { useAuth } from '../../auth/auth-context';
import { Button, ErrorBanner, FormField, SuccessBanner } from '../../components/form';
import { OtpStep } from '../../components/otp-step';
import { useLocale } from '../../i18n/locale-context';
import { colors, fontSize, spacing } from '../../theme/tokens';

type Step = 'newPhone' | 'verifyCurrent' | 'verifyNew' | 'done';

/**
 * UC-S-06 — Change phone number (2FA), the three contract steps:
 * 1. declare the new phone (409 when in use) — OTP goes to the CURRENT phone
 * 2. prove the current phone (400 wrong / 410 expired → restart)
 * 3. prove the new phone (OTP sent there on step-2 success)
 * Nothing mutates on failure (ES-02) — a 410 anywhere restarts the wizard.
 */
export default function ChangePhoneScreen() {
  const { t, isRTL } = useLocale();
  const { user, setUser } = useAuth();

  const [step, setStep] = useState<Step>('newPhone');
  const [newPhone, setNewPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [restartNotice, setRestartNotice] = useState(false);
  const [busy, setBusy] = useState(false);

  const trimmedPhone = newPhone.trim();

  const restart = () => {
    setStep('newPhone');
    setOtpError(null);
    setRestartNotice(true);
  };

  const start = async () => {
    if (!isValidPhone(trimmedPhone)) {
      setPhoneError(t('auth.phoneInvalid'));
      return;
    }
    setPhoneError(null);
    setRestartNotice(false);
    setBusy(true);
    try {
      await phoneChangeStart(trimmedPhone);
      setOtpError(null);
      setStep('verifyCurrent');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // UC-S-06 E1 — new phone already in use.
        setPhoneError(t('changePhone.phoneTaken'));
      } else if (error instanceof ApiError && error.status === 429) {
        setPhoneError(t('auth.otpHourlyCap'));
      } else {
        setPhoneError(t('auth.otpSendFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const verifyCurrent = async (code: string) => {
    setBusy(true);
    setOtpError(null);
    try {
      await phoneChangeVerifyCurrent(code);
      // Success → the backend sent a code to the NEW phone.
      setStep('verifyNew');
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setOtpError(t('auth.otpWrong'));
      } else if (error instanceof ApiError && error.status === 410) {
        restart();
      } else {
        setOtpError(t('common.networkError'));
      }
    } finally {
      setBusy(false);
    }
  };

  const verifyNew = async (code: string) => {
    setBusy(true);
    setOtpError(null);
    try {
      const updated = await phoneChangeComplete(code);
      setUser(updated);
      setStep('done');
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setOtpError(t('auth.otpWrong'));
      } else if (error instanceof ApiError && error.status === 410) {
        restart();
      } else {
        setOtpError(t('common.networkError'));
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
      testID="change-phone-screen"
    >
      {step === 'newPhone' ? (
        <View style={styles.step} testID="change-phone-step-new">
          <Text style={[styles.intro, isRTL && styles.textRtl]}>{t('changePhone.intro')}</Text>
          {restartNotice ? (
            <ErrorBanner message={t('changePhone.restart')} testID="change-phone-restart" />
          ) : null}
          <FormField
            label={t('changePhone.newPhoneLabel')}
            placeholder={t('auth.phonePlaceholder')}
            value={newPhone}
            onChangeText={setNewPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            error={phoneError}
            testID="change-phone-new"
          />
          <Button
            label={t('changePhone.start')}
            onPress={() => void start()}
            loading={busy}
            testID="change-phone-start"
          />
        </View>
      ) : null}

      {step === 'verifyCurrent' ? (
        <View style={styles.step} testID="change-phone-step-current">
          <OtpStep
            hint={t('changePhone.verifyCurrentHint', { phone: user?.phone ?? '' })}
            error={otpError}
            busy={busy}
            onVerify={verifyCurrent}
            testIDPrefix="change-phone-current"
          />
        </View>
      ) : null}

      {step === 'verifyNew' ? (
        <View style={styles.step} testID="change-phone-step-verify-new">
          <OtpStep
            hint={t('changePhone.verifyNewHint', { phone: trimmedPhone })}
            error={otpError}
            busy={busy}
            onVerify={verifyNew}
            testIDPrefix="change-phone-new-otp"
          />
        </View>
      ) : null}

      {step === 'done' ? (
        <View style={styles.step} testID="change-phone-step-done">
          <SuccessBanner message={t('changePhone.done')} testID="change-phone-done" />
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
