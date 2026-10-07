/**
 * Render helper for component tests: wraps the UI in LocaleProvider +
 * AuthProvider and adds a probe exposing the auth state as text, so flows
 * can assert "reached the signed-in/signed-out state" without a router.
 */
import { render } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

import { AuthProvider, useAuth } from "../auth/auth-context";
import { LocaleProvider } from "../i18n/locale-context";

function AuthStatusProbe() {
  const { status, signOutReason } = useAuth();
  return (
    <Text testID="auth-status">
      {signOutReason ? `${status}:${signOutReason}` : status}
    </Text>
  );
}

export function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LocaleProvider>
      <AuthProvider>
        {ui}
        <AuthStatusProbe />
      </AuthProvider>
    </LocaleProvider>,
  );
}
