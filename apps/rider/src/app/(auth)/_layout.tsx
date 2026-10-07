import { Redirect, Stack } from "expo-router";
import React from "react";

import { useAuth } from "../../auth/auth-context";
import { ScreenHeader } from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { colors } from "../../theme/tokens";

/** Signed-out stack: welcome, login, register, forgot password. */
export default function AuthLayout() {
  const { status } = useAuth();
  const { t } = useLocale();

  if (status === "signedIn") {
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{
        header: ({ navigation, options, back }) => (
          <ScreenHeader
            title={typeof options.title === "string" ? options.title : ""}
            onBack={back ? navigation.goBack : undefined}
          />
        ),
        contentStyle: { backgroundColor: colors.surface },
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ title: t("login.title") }} />
      <Stack.Screen name="register" options={{ title: t("register.title") }} />
      <Stack.Screen
        name="forgot-password"
        options={{ title: t("forgot.title") }}
      />
    </Stack>
  );
}
