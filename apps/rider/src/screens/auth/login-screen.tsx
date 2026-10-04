import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { isValidPhone, login } from '../../api/auth';
import { ApiError } from '../../api/http-client';
import { useAuth } from '../../auth/auth-context';
import { Button, ErrorBanner, FormField } from '../../components/form';
import { useLocale } from '../../i18n/locale-context';
import { colors, fontSize, spacing } from '../../theme/tokens';

/**
 * UC-S-02 — Log in with phone + password (never OTP-gated, AUTH-05).
 * Error mapping per contract: 401 generic (bad credentials OR deleted
 * account, indistinguishable by design), 403 no valid role for the rider
 * client, 429 throttled after repeated failures (NFR-S3).
 */
export default function LoginScreen() {
  const { t, isRTL } = useLocale();
  const { signIn } = useAuth();
  const router = useRouter();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const phoneOk = isValidPhone(phone.trim());
    const passwordOk = password.length > 0;
    setPhoneError(phoneOk ? null : t('auth.phoneInvalid'));
    setPasswordError(passwordOk ? null : t('login.passwordRequired'));
    if (!phoneOk || !passwordOk) {
      return;
    }
    setServerError(null);
    setBusy(true);
    try {
      const session = await login({ phone: phone.trim(), password, client: 'rider' });
      await signIn(session);
      // Navigation is handled by the (auth) group guard once signed in.
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          setServerError(t('login.invalidCredentials'));
        } else if (error.status === 403) {
          setServerError(t('login.noValidRole'));
        } else if (error.status === 429) {
          setServerError(t('login.throttled'));
        } else {
          setServerError(t('common.networkError'));
        }
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
      testID="login-screen"
    >
      <Text style={[styles.title, isRTL && styles.textRtl]}>{t('login.title')}</Text>
      {serverError ? <ErrorBanner message={serverError} testID="login-server-error" /> : null}
      <FormField
        label={t('auth.phoneLabel')}
        placeholder={t('auth.phonePlaceholder')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoCapitalize="none"
        error={phoneError}
        testID="login-phone"
      />
      <FormField
        label={t('auth.passwordLabel')}
        placeholder={t('login.passwordPlaceholder')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        error={passwordError}
        testID="login-password"
      />
      <Button label={t('login.submit')} onPress={submit} loading={busy} testID="login-submit" />
      <View style={styles.links}>
        <Button
          variant="link"
          label={t('login.forgotPassword')}
          onPress={() => router.push('/forgot-password')}
          testID="login-forgot"
        />
        <Button
          variant="link"
          label={t('login.noAccount')}
          onPress={() => router.push('/register')}
          testID="login-to-register"
        />
      </View>
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
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  links: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
});
