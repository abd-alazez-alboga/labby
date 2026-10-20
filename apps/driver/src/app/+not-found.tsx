import { Redirect } from "expo-router";
import React from "react";

import { useAuth } from "../auth/AuthProvider";

/**
 * Unknown `labbydriver://` links (I98) never show expo-router's English
 * "unmatched route" page: they land where the account belongs — welcome
 * when signed out, home for an active driver, the gate otherwise.
 */
export default function NotFound() {
  const { status, isDriver } = useAuth();
  if (status !== "signedIn") return <Redirect href="/welcome" />;
  return <Redirect href={isDriver ? "/" : "/apply-to-drive"} />;
}
